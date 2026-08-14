// src/workflows/digest-workflow.ts
//
// ⚠️ 上线后修改本文件：只在末尾追加 step，不要改已有 step 名/顺序——
// 运行中实例恢复时按 step 名重放已完成结果，改名会导致重放错乱。
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import {
  fetchFullText,
  RELEVANCE_THRESHOLD,
  reviewCandidate,
  scopeDirection,
  scoreSourceItems,
  searchAngle,
  synthesizeDigest,
  translateDigest,
  verifyCandidate,
} from "#/lib/digest/ai";
import {
  mergeCandidates,
  partitionCandidates,
  tallyVotes,
  type VoteOutcome,
} from "#/lib/digest/candidates";
import { enrichAuthorSignals } from "#/lib/digest/enrich";
import { cheapModel, strongModel } from "#/lib/digest/llm";
import { fetchS2Fallback } from "#/lib/digest/s2-fallback";
import {
  ArxivRateLimitError,
  fetchDirectionSource,
} from "#/lib/digest/sources";
import {
  canonicalizeCandidate,
  countUnfinishedPapers,
  ensureDigestShell,
  finalizeDigestPapers,
  findUnfinishedPaperIds,
  loadDirectionContext,
  recordSourceResult,
  saveDigestContent,
  updateCandidateStatus,
  upsertCandidatesSeen,
} from "#/lib/digest/store";
import type {
  AuthorSignal,
  CandidateItem,
  ReviewedCandidate,
  SynthesisResult,
} from "#/lib/digest/types";
import { submitIndexNow } from "#/lib/indexnow";
import {
  MAX_SOURCE_FAILURES,
  selectFetchTargets,
} from "#/lib/news/source-health";
import { SITE_URL } from "#/lib/site-url";
import type { Env } from "#/types/env";

export type DigestWorkflowParams = {
  directionId: string;
  /** 触发日 ISO（periodEnd）；cron 侧传入保证可复现 */
  periodEnd: string;
  /** cron 侧按方向下标错峰启动，降低/错开多个实例同时打 arXiv 的概率（非硬保证，
   * 见 digest-cron.ts 注释）；admin 手动触发不传 = 不错峰 */
  staggerMinutes?: number;
};

const WINDOW_DAYS = 7;
const LLM_RETRIES = {
  retries: {
    limit: 2,
    delay: "20 seconds" as const,
    backoff: "exponential" as const,
  },
  timeout: "5 minutes" as const,
};
const VOTES = 3;
/** 精读分数过线才进对抗验证 */
const REVIEW_PASS_SCORE = 55;
/** 论文处理等待：18 轮 × 10 分钟 = 最多 3 小时后兜底发布 */
const PUBLISH_POLL_ROUNDS = 18;
/** arXiv 429 惩罚期实测是分钟级，20s 级退避只会连吃 429，须用分钟级恒定退避 */
const ARXIV_SCAN_RETRIES = {
  retries: {
    limit: 2,
    delay: "5 minutes" as const,
    backoff: "constant" as const,
  },
  timeout: "5 minutes" as const,
};

/** 简单分批并发（角度搜索/精读/验证的批内 Promise.all，批间串行） */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export class DigestWorkflow extends WorkflowEntrypoint<
  Env,
  DigestWorkflowParams
> {
  async run(
    event: Readonly<WorkflowEvent<DigestWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<{ digestId: string; picks: number }> {
    const env = this.env;
    const db = drizzle(env.DB);
    const { directionId } = event.payload;
    const periodEnd = new Date(event.payload.periodEnd);
    const periodStart = new Date(periodEnd.getTime() - WINDOW_DAYS * 86400_000);
    const periodLabel = `${periodStart.toISOString().slice(0, 10)} ~ ${periodEnd.toISOString().slice(0, 10)}`;

    // ── 0. 跨实例错峰：cron 一次性创建全部方向实例，不错峰会让 export.arxiv.org
    // 瞬时收到 ~30 源并发请求，远超其 1 req/3s 的限速 ──
    const staggerMinutes = event.payload.staggerMinutes ?? 0;
    if (staggerMinutes > 0) {
      await step.sleep("stagger-start", `${staggerMinutes} minutes`);
    }

    // ── 1. 加载上下文 + digest shell ──
    const ctx = await step.do("load-context", () =>
      loadDirectionContext(db, directionId),
    );
    const shell = await step.do("ensure-digest-shell", () =>
      ensureDigestShell(db, {
        directionId,
        workflowInstanceId: event.instanceId,
        periodStart,
        periodEnd,
      }),
    );

    try {
      // ── 2. Scope：角度分解（强模型）──
      const scope = await step.do("scope", LLM_RETRIES, () =>
        scopeDirection(strongModel(env), {
          directionName: ctx.direction.name["zh-cn"] ?? ctx.direction.slug,
          focusBrief: ctx.direction.focusBrief,
          feedback: ctx.feedback,
          sourceLabels: ctx.sources.filter((s) => s.enabled).map((s) => s.id),
        }),
      );

      // ── 3. 确定性扫源（每源一个 step；熔断源按探活节奏跳过）──
      // 候选集与 news-cron 一致：enabled 的健康源 ∪ 已达熔断阈值的源（后者才是
      // shouldProbe 的探活对象——人为停用的源 consecutiveFailures 恒为 0，两个
      // 条件都不满足，正确地被排除）。
      // 用 event.timestamp（实例创建时刻，跨重放不变）而非 Date.now()：run() 主体
      // 在每次 hibernate 唤醒后从头重新求值，本轮 publish-poll 最长跨 3 小时，若用
      // Date.now() 会让「本轮扫哪些源」在重放间漂移——已缓存的 scan-source-* 步骤
      // 不受影响，但新落入候选集的源会在重放时真的执行一次（含真实抓取/付费 LLM
      // 调用），产出却被 merge-and-budget 的缓存结果丢弃。
      const now = event.timestamp.getTime();
      const sourceCandidates = ctx.sources.filter(
        (s) => s.enabled || s.consecutiveFailures >= MAX_SOURCE_FAILURES,
      );
      const { targets: activeSources, probes } = selectFetchTargets(
        sourceCandidates,
        now,
      );
      if (probes.length > 0) {
        console.log(
          `[Digest] ${ctx.direction.slug}: probing ${probes.length} tripped source(s): ${probes.map((s) => s.id).join(", ")}`,
        );
      }
      // 源扫描严格串行（不再 chunk(3) 并发）：arXiv 对 export.arxiv.org 要求
      // 单连接 1 req/3s，且实测还有分钟级窗口配额，并发扫多个 arxiv_query 源
      // 会直接触发 429。rss 源无此限制，但为保持顺序简单一律走同一条串行链。
      const sourceGroups: CandidateItem[][] = [];
      for (let i = 0; i < activeSources.length; i++) {
        const source = activeSources[i];
        if (source.adapterType === "arxiv_query" && i > 0) {
          // 仅 arxiv_query 源之间需要限速间隔；step 名用 activeSources 下标
          // （由 event.timestamp 派生，重放稳定）而非 source.id，保证唯一且可重放
          await step.sleep(`arxiv-gap-${i}`, "4 seconds");
        }
        const retryConfig =
          source.adapterType === "arxiv_query"
            ? ARXIV_SCAN_RETRIES
            : LLM_RETRIES;
        const items = await step
          .do(`scan-source-${source.id}`, retryConfig, async () => {
            try {
              const items = await fetchDirectionSource(
                source.adapterType,
                source.config,
                periodStart,
                source.id,
              );
              // 初筛（廉价模型）：只留过线条目
              const scores = await scoreSourceItems(
                cheapModel(env),
                ctx.direction.focusBrief,
                items.map((i) => ({ title: i.title, excerpt: i.excerpt })),
              );
              await recordSourceResult(
                db,
                source.id,
                source.consecutiveFailures,
                { ok: true },
              );
              return items
                .map((it, i) => ({ ...it, prescore: scores[i] }))
                .filter((it) => (it.prescore ?? 0) >= RELEVANCE_THRESHOLD);
            } catch (e) {
              // 429 不计熔断（是我们自己的速率问题，不是源死了）：直接重抛，
              // 交给 step 的分钟级退避重试；其余错误才走熔断记账
              if (e instanceof ArxivRateLimitError) throw e;
              // 源失败不失败整期：记熔断，返回空
              await recordSourceResult(
                db,
                source.id,
                source.consecutiveFailures,
                {
                  ok: false,
                  error: e instanceof Error ? e.message : String(e),
                },
              );
              return [] as CandidateItem[];
            }
          })
          .catch(async (e): Promise<CandidateItem[]> => {
            // 跨 step 边界后 e 可能已被引擎重建为普通 Error（只保留 name/message），
            // instanceof ArxivRateLimitError 不可靠，改用 name/message 识别
            const msg = e instanceof Error ? e.message : String(e);
            const isRateLimit =
              (e instanceof Error && e.name === "ArxivRateLimitError") ||
              msg.includes("429");
            if (isRateLimit) {
              // 429 退避耗尽（分钟级退避 × 2 次仍失败）：不计熔断（是我们自己的
              // 速率问题，不是源死了）。先试 S2 bulk search 文本兜底再丢弃——
              // 只对 arxiv_query 源有意义（rss 源无 query 可映射；msg.includes
              // ("429") 是已知的宽匹配，rss 源理论上也可能落进这个分支，此时
              // 保持原有的直接丢弃语义）。S2 收录 arXiv 有几天延迟，最新 1-2 天
              // 的论文本周可能兜不到，欠的下周会从 seen 池自然回补，是接受的取舍。
              if (source.adapterType !== "arxiv_query") {
                console.warn(
                  `[Digest] scan-source-${source.id}: rate-limit retries exhausted, dropping this source for this issue`,
                );
                return [] as CandidateItem[];
              }
              console.warn(
                `[Digest] scan-source-${source.id}: rate-limit retries exhausted, trying S2 fallback`,
              );
              return step
                .do(
                  `scan-source-${source.id}-s2-fallback`,
                  LLM_RETRIES,
                  async () => {
                    const items = await fetchS2Fallback(
                      source.config,
                      periodStart,
                      `${source.id}:s2-fallback`,
                      env.SEMANTIC_SCHOLAR_API_KEY,
                    );
                    const scores = await scoreSourceItems(
                      cheapModel(env),
                      ctx.direction.focusBrief,
                      items.map((i) => ({
                        title: i.title,
                        excerpt: i.excerpt,
                      })),
                    );
                    return items
                      .map((it, i) => ({ ...it, prescore: scores[i] }))
                      .filter(
                        (it) => (it.prescore ?? 0) >= RELEVANCE_THRESHOLD,
                      );
                  },
                )
                .catch((e2): CandidateItem[] => {
                  console.warn(
                    `[Digest] scan-source-${source.id}: S2 fallback also failed, dropping this source for this issue:`,
                    e2,
                  );
                  return [] as CandidateItem[];
                });
            }
            // 非 429 的 step 级失败（fetch 挂死超时、D1 写失败等）：计熔断后降级，
            // 让永久挂死的源最终走熔断+探活，而不是每周静默消失
            console.warn(
              `[Digest] scan-source-${source.id} failed at step level:`,
              e,
            );
            try {
              await recordSourceResult(
                db,
                source.id,
                source.consecutiveFailures,
                { ok: false, error: msg },
              );
            } catch (recordErr) {
              // 记账失败不能让整个 workflow 跟着失败——这里已经是降级兜底路径
              console.warn(
                `[Digest] scan-source-${source.id}: failed to record breaker failure:`,
                recordErr,
              );
            }
            return [] as CandidateItem[];
          });
        sourceGroups.push(items);
      }

      // ── 4. 角度搜索扇出（每角度一个 step）──
      // step 名带全局序号：LLM 可能产出重复 label，裸 label 会撞 step 名导致重放错乱
      const indexedAngles = scope.angles.map((angle, i) => ({ angle, i }));
      const angleGroups: CandidateItem[][] = [];
      // 批 2 并发：每角度 12 轮搜索 + 打分，3 并发实跑触发过网关 429
      for (const batch of chunk(indexedAngles, 2)) {
        const results = await Promise.all(
          batch.map(({ angle, i }) =>
            step.do(
              `search-angle-${i}-${angle.label}`,
              LLM_RETRIES,
              async () => {
                try {
                  const found = await searchAngle(
                    env,
                    cheapModel(env).model,
                    ctx.direction.focusBrief,
                    angle,
                    periodLabel,
                  );
                  const items = found
                    .map((it) => canonicalizeCandidate(it, periodEnd))
                    .filter((it): it is CandidateItem => it !== null);
                  try {
                    const scores = await scoreSourceItems(
                      cheapModel(env),
                      ctx.direction.focusBrief,
                      items.map((i) => ({
                        title: i.title,
                        excerpt: i.excerpt,
                      })),
                    );
                    return items
                      .map((it, i) => ({ ...it, prescore: scores[i] }))
                      .filter(
                        (it) => (it.prescore ?? 0) >= RELEVANCE_THRESHOLD,
                      );
                  } catch (e) {
                    // 初筛被限流（429）等瞬时失败时不能丢弃整个角度——昂贵的搜索
                    // 已经成功，打分只是省精读钱的优化。降级为不打分放行（prescore
                    // 留空），由精读把关；实跑教训：本 catch 在 step 内，外层的
                    // step 重试对这里永远不生效。
                    console.warn(
                      `[Digest] angle ${angle.label} prescore failed, passing unscored:`,
                      e,
                    );
                    return items;
                  }
                } catch (e) {
                  console.error(`[Digest] angle ${angle.label} failed:`, e);
                  return [] as CandidateItem[];
                }
              },
            ),
          ),
        );
        angleGroups.push(...results);
      }

      // ── 5. 合并去重 + 候选池对齐 + 预算（纯代码）──
      const partition = await step.do("merge-and-budget", async () => {
        const merged = mergeCandidates(
          [...sourceGroups, ...angleGroups],
          new Map(ctx.hfUpvotesByArxivId),
        );
        const result = partitionCandidates(merged, ctx.pool);
        await upsertCandidatesSeen(db, directionId, [
          ...result.toReview,
          ...result.overBudget,
        ]);
        // 四个计数是「no silent caps」审计轨迹，必须完整保留——即使 skipped
        // 本身不会进入下面的 return（下游从不读它）。
        console.log(
          `[Digest] ${ctx.direction.slug}: merged=${merged.length} review=${result.toReview.length} overBudget=${result.overBudget.length} skipped=${result.skipped.length}`,
        );
        // step 返回值会整份持久化在 workflow state 里：只带下游真正读取的字段
        // （toReview 全量、overBudget 仅 title），skipped 与 overBudget 的其余
        // 字段不返回。
        return {
          toReview: result.toReview,
          overBudgetTitles: result.overBudget.map((i) => i.title),
        };
      });

      // ── 5b. 作者信号富集（S2 batch，每期一次）──
      // 可降级的优化环节：任何失败（429/超时/未收录）都降级为无信号并留痕，
      // 绝不失败整期（同 angle prescore 的降级模式）。全 intel 时零请求。
      const authorSignals = await step
        .do("enrich-author-signal", () =>
          enrichAuthorSignals(
            partition.toReview
              .filter((it) => it.kind === "paper")
              .map((it) => it.canonicalUrl),
            env.SEMANTIC_SCHOLAR_API_KEY,
          ),
        )
        .catch((e): Record<string, AuthorSignal> => {
          console.warn(
            "[Digest] enrich-author-signal failed, degrading to no signal:",
            e,
          );
          return {};
        });

      // ── 6. 逐篇精读（每篇一个 step，含全文抓取）──
      // step 名带全局序号（同角度搜索的理由）：批内下标会在不同批次间重复，
      // URL 尾 60 字符理论上也可能撞车，全局序号才是唯一性的真正保证。
      const reviewed: ReviewedCandidate[] = [];
      const indexedToReview = partition.toReview.map(
        (item, i): { item: CandidateItem; i: number } => ({
          item: { ...item, authorSignal: authorSignals[item.canonicalUrl] },
          i,
        }),
      );
      for (const batch of chunk(indexedToReview, 4)) {
        const results = await Promise.all(
          batch.map(({ item, i }) =>
            step
              .do(
                `review-${i}-${item.canonicalUrl.slice(-60)}`,
                LLM_RETRIES,
                async () => {
                  const fullText =
                    item.kind === "paper"
                      ? await fetchFullText(item.canonicalUrl)
                      : null;
                  const review = await reviewCandidate(
                    cheapModel(env),
                    ctx.direction.focusBrief,
                    item,
                    fullText,
                    item.kind === "paper" ? ctx.history.pastPicks : [],
                  );
                  await updateCandidateStatus(
                    db,
                    directionId,
                    item.canonicalUrl,
                    {
                      score: review.score,
                    },
                  );
                  return { item, review } satisfies ReviewedCandidate;
                },
              )
              .catch((e) => {
                console.error(
                  `[Digest] review failed ${item.canonicalUrl}:`,
                  e,
                );
                return null; // 单篇失败不失败整期
              }),
          ),
        );
        reviewed.push(
          ...results.filter((r): r is ReviewedCandidate => r !== null),
        );
      }

      const paperCandidates = reviewed.filter(
        (r) => r.item.kind === "paper" && r.review.score >= REVIEW_PASS_SCORE,
      );
      const intelCandidates = reviewed.filter((r) => r.item.kind === "intel");

      // ── 7. 对抗验证（每篇一个 step，step 内 3 票）──
      // 同上：step 名用全局序号保证唯一，URL 尾 60 字符仅供可读性。
      const verdicts: Array<{ r: ReviewedCandidate; outcome: VoteOutcome }> =
        [];
      const indexedPaperCandidates = paperCandidates.map((r, i) => ({ r, i }));
      for (const batch of chunk(indexedPaperCandidates, 4)) {
        const results = await Promise.all(
          batch.map(({ r, i }) =>
            step
              .do(
                `verify-${i}-${r.item.canonicalUrl.slice(-60)}`,
                LLM_RETRIES,
                async () => {
                  const votes = await Promise.all(
                    Array.from({ length: VOTES }, (_, v) =>
                      verifyCandidate(
                        cheapModel(env),
                        ctx.direction.focusBrief,
                        r,
                        v,
                        ctx.history.pastPicks,
                      ).catch(() => null),
                    ),
                  );
                  const outcome = tallyVotes(votes);
                  if (outcome === "unverified") {
                    // 有效票 <2 全是 infra 失败（单票 catch 是静默的）——必须留痕，
                    // 否则限流吃掉高分候选时监控完全看不见（2026-08-10 实跑教训）
                    console.warn(
                      `[Digest] verify ${r.item.canonicalUrl}: <2 valid votes (infra failure), kept seen for next issue`,
                    );
                  }
                  if (outcome === "rejected") {
                    await updateCandidateStatus(
                      db,
                      directionId,
                      r.item.canonicalUrl,
                      {
                        status: "rejected",
                      },
                    );
                  }
                  // unverified 保持 seen，下期重评（infra 失败 ≠ 否决）
                  return outcome;
                },
              )
              .then((outcome) => ({ r, outcome })),
          ),
        );
        verdicts.push(...results);
      }
      const passedPapers = verdicts.filter((v) => v.outcome === "pass");

      // ── 8. 定稿（强模型）──
      // 重试上限高于其他 LLM step：实跑网关会间歇吐空白 body（约 40s 截断，
      // 重试可穿过），叠加模型偶发 JSON 转义错，3 次尝试不够、曾整期失败
      const synthesis: SynthesisResult = await step.do(
        "synthesize",
        {
          ...LLM_RETRIES,
          retries: { ...LLM_RETRIES.retries, limit: 5 },
          timeout: "10 minutes",
        },
        () =>
          synthesizeDigest(env, strongModel(env).model, {
            directionName: ctx.direction.name["zh-cn"] ?? ctx.direction.slug,
            focusBrief: ctx.direction.focusBrief,
            issueNumber: shell.issueNumber,
            periodLabel,
            feedback: ctx.feedback,
            pastPicks: ctx.history.pastPicks,
            lastIssue:
              ctx.history.lastIssueBody !== null &&
              ctx.history.lastIssueNumber !== null
                ? {
                    issueNumber: ctx.history.lastIssueNumber,
                    body: ctx.history.lastIssueBody,
                  }
                : null,
            papers: passedPapers.map((v) => ({
              ...v.r,
              voteOutcome: v.outcome,
            })),
            intel: intelCandidates,
          }),
      );

      // ── 9. 翻译（每语言一个 step）──
      const reviewedByUrl = new Map(
        reviewed.map((r) => [r.item.canonicalUrl, r]),
      );
      const primaryNotes = Object.fromEntries(
        synthesis.picks.map((p) => [p.canonicalUrl, p.recommendationNote]),
      );
      const translations: Record<
        string,
        { title: string; content: string; notes: Record<string, string> }
      > = {
        "zh-cn": {
          title: synthesis.title,
          content: synthesis.content,
          notes: primaryNotes,
        },
      };
      for (const locale of ["zh-tw", "en", "ja"] as const) {
        translations[locale] = await step
          .do(`translate-${locale}`, LLM_RETRIES, () =>
            translateDigest(cheapModel(env), locale, translations["zh-cn"]),
          )
          .catch(() => translations["zh-cn"]); // 翻译失败回退主语言，不失败整期
      }

      // ── 10. 落库：论文入 gallery 管线 + digest 内容 ──
      const finalize = await step.do("finalize", async () => {
        const notesByUrl = new Map<string, Record<string, string>>();
        for (const pick of synthesis.picks) {
          notesByUrl.set(
            pick.canonicalUrl,
            Object.fromEntries(
              Object.entries(translations).map(([loc, t]) => [
                loc,
                t.notes[pick.canonicalUrl] ??
                  primaryNotes[pick.canonicalUrl] ??
                  "",
              ]),
            ),
          );
        }
        const result = await finalizeDigestPapers(db, env, {
          digestId: shell.digestId,
          directionId,
          directionSlug: ctx.direction.slug,
          issueNumber: shell.issueNumber,
          picks: synthesis.picks,
          reviewedByUrl,
          notesByUrl,
        });
        // intel 跨期去重：只有被正文实际引用的 intel 才标 recommended（下期跳过）；
        // 精读过但没用上的保持 seen，下期仍有入选机会。
        const intelUrls = new Set(
          intelCandidates.map((r) => r.item.canonicalUrl),
        );
        for (const url of synthesis.usedIntelUrls ?? []) {
          if (intelUrls.has(url)) {
            await updateCandidateStatus(db, directionId, url, {
              status: "recommended",
            });
          }
        }
        await saveDigestContent(db, shell.digestId, {
          title: Object.fromEntries(
            Object.entries(translations).map(([loc, t]) => [loc, t.title]),
          ),
          content: Object.fromEntries(
            Object.entries(translations).map(([loc, t]) => [loc, t.content]),
          ),
          proposedFocusUpdate: synthesis.proposedFocusUpdate ?? null,
        });
        return result;
      });

      // ── 11. 等论文处理完（或 3 小时兜底）后发布 ──
      let unfinished = 0;
      for (let i = 0; i < PUBLISH_POLL_ROUNDS; i++) {
        unfinished = await step.do(`check-papers-${i}`, () =>
          countUnfinishedPapers(db, finalize.paperIds),
        );
        if (unfinished === 0) break;
        await step.sleep(`wait-papers-${i}`, "10 minutes");
      }
      // 3 小时兜底到点仍有未完成论文：不阻塞发布、不自动补救，但必须留下可见痕迹——
      // 已知有「论文行已插但入队失败」的窄失败面（PAPER_QUEUE.send 在 papers 行插入
      // 后失败，重试时去重 SELECT 会短路，永远不会重新入队），不留痕会悄无声息漏发。
      if (unfinished > 0) {
        await step.do("warn-unfinished-before-publish", async () => {
          const ids = await findUnfinishedPaperIds(db, finalize.paperIds);
          console.warn(
            `[Digest] digest ${shell.digestId}: publishing with ${unfinished} paper(s) still unfinished after ${PUBLISH_POLL_ROUNDS} poll rounds: ${ids.join(", ")}`,
          );
        });
      }
      await step.do("publish", async () => {
        await saveDigestContent(db, shell.digestId, {
          status: "published",
          publishedAt: new Date(),
        });
        // 发布后主动通知 IndexNow（Bing/Copilot/DuckDuckGo 等几分钟内抓取）。
        // submitIndexNow 内部吞掉一切失败、未配置 key 时直接返回，所以 await 它
        // 不会让发布失败；必须 await——step 返回后上下文可能被拆掉，浮着的
        // promise 会被丢弃。
        await submitIndexNow({
          siteUrl: SITE_URL,
          key: env.INDEXNOW_KEY,
          urls: [
            `${SITE_URL}/gallery/d/${ctx.direction.slug}/${shell.issueNumber}`,
            `${SITE_URL}/gallery/d/${ctx.direction.slug}`,
          ],
        });
      });

      return { digestId: shell.digestId, picks: synthesis.picks.length };
    } catch (e) {
      // 编排级失败：标记 failed 后原样抛出（实例进 errored，便于排查/restart）。
      // mark-failed 自身若失败（默认重试策略耗尽后仍抛出），不能让这个记账错误
      // 盖过根因——单独 catch、记录，再无条件抛出原始 e。
      try {
        await step.do("mark-failed", () =>
          saveDigestContent(db, shell.digestId, { status: "failed" }),
        );
      } catch (markFailedError) {
        console.error(
          `[Digest] mark-failed itself failed for digest ${shell.digestId}:`,
          markFailedError,
        );
      }
      throw e;
    }
  }
}
