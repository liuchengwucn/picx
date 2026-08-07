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
import { cheapModel, strongModel } from "#/lib/digest/llm";
import { fetchDirectionSource } from "#/lib/digest/sources";
import {
  canonicalizeCandidate,
  countUnfinishedPapers,
  ensureDigestShell,
  finalizeDigestPapers,
  loadDirectionContext,
  recordSourceResult,
  saveDigestContent,
  updateCandidateStatus,
  upsertCandidatesSeen,
} from "#/lib/digest/store";
import type {
  CandidateItem,
  ReviewedCandidate,
  SynthesisResult,
} from "#/lib/digest/types";
import { shouldProbe } from "#/lib/news/source-health";
import type { Env } from "#/types/env";

export type DigestWorkflowParams = {
  directionId: string;
  /** 触发日 ISO（periodEnd）；cron 侧传入保证可复现 */
  periodEnd: string;
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

/** 简单分批并发（源扫描/精读的批内 Promise.all，批间串行） */
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
      const now = Date.now();
      const activeSources = ctx.sources.filter(
        (s) =>
          (s.enabled && s.consecutiveFailures === 0) ||
          (s.enabled && shouldProbe(s, now)),
      );
      const sourceGroups: CandidateItem[][] = [];
      for (const batch of chunk(activeSources, 3)) {
        const results = await Promise.all(
          batch.map((source) =>
            step.do(`scan-source-${source.id}`, LLM_RETRIES, async () => {
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
                await recordSourceResult(db, source.id, { ok: true });
                return items.filter((_, i) => scores[i] >= RELEVANCE_THRESHOLD);
              } catch (e) {
                // 源失败不失败整期：记熔断，返回空
                await recordSourceResult(db, source.id, {
                  ok: false,
                  error: e instanceof Error ? e.message : String(e),
                });
                return [] as CandidateItem[];
              }
            }),
          ),
        );
        sourceGroups.push(...results);
      }

      // ── 4. 角度搜索扇出（每角度一个 step）──
      // step 名带全局序号：LLM 可能产出重复 label，裸 label 会撞 step 名导致重放错乱
      const indexedAngles = scope.angles.map((angle, i) => ({ angle, i }));
      const angleGroups: CandidateItem[][] = [];
      for (const batch of chunk(indexedAngles, 3)) {
        const results = await Promise.all(
          batch.map(({ angle, i }) =>
            step.do(
              `search-angle-${i}-${angle.label}`,
              LLM_RETRIES,
              async () => {
                try {
                  const items = await searchAngle(
                    env,
                    cheapModel(env).model,
                    ctx.direction.focusBrief,
                    angle,
                    periodLabel,
                  );
                  return items.map(canonicalizeCandidate);
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
        console.log(
          `[Digest] ${ctx.direction.slug}: merged=${merged.length} review=${result.toReview.length} overBudget=${result.overBudget.length} skipped=${result.skipped.length}`,
        );
        return result;
      });

      // ── 6. 逐篇精读（每篇一个 step，含全文抓取）──
      const reviewed: ReviewedCandidate[] = [];
      for (const batch of chunk(partition.toReview, 4)) {
        const results = await Promise.all(
          batch.map((item, bi) =>
            step
              .do(
                `review-${item.canonicalUrl.slice(-60)}-${bi}`,
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
      const verdicts: Array<{ r: ReviewedCandidate; outcome: VoteOutcome }> =
        [];
      for (const batch of chunk(paperCandidates, 4)) {
        const results = await Promise.all(
          batch.map((r, bi) =>
            step
              .do(
                `verify-${r.item.canonicalUrl.slice(-60)}-${bi}`,
                LLM_RETRIES,
                async () => {
                  const votes = await Promise.all(
                    Array.from({ length: VOTES }, (_, v) =>
                      verifyCandidate(
                        cheapModel(env),
                        ctx.direction.focusBrief,
                        r,
                        v,
                      ).catch(() => null),
                    ),
                  );
                  const outcome = tallyVotes(votes);
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
      const rejectedTitles = verdicts
        .filter((v) => v.outcome === "rejected")
        .map((v) => v.r.item.title);

      // ── 8. 定稿（强模型）──
      const synthesis: SynthesisResult = await step.do(
        "synthesize",
        { ...LLM_RETRIES, timeout: "10 minutes" },
        () =>
          synthesizeDigest(strongModel(env), {
            directionName: ctx.direction.name["zh-cn"] ?? ctx.direction.slug,
            focusBrief: ctx.direction.focusBrief,
            issueNumber: shell.issueNumber,
            periodLabel,
            feedback: ctx.feedback,
            papers: passedPapers.map((v) => ({
              ...v.r,
              voteOutcome: v.outcome,
            })),
            intel: intelCandidates,
            rejectedTitles,
            overBudgetTitles: partition.overBudget.map((i) => i.title),
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
      for (let i = 0; i < PUBLISH_POLL_ROUNDS; i++) {
        const unfinished = await step.do(`check-papers-${i}`, () =>
          countUnfinishedPapers(db, finalize.paperIds),
        );
        if (unfinished === 0) break;
        await step.sleep(`wait-papers-${i}`, "10 minutes");
      }
      await step.do("publish", () =>
        saveDigestContent(db, shell.digestId, {
          status: "published",
          publishedAt: new Date(),
        }),
      );

      return { digestId: shell.digestId, picks: synthesis.picks.length };
    } catch (e) {
      // 编排级失败：标记 failed 后原样抛出（实例进 errored，便于排查/restart）
      await step.do("mark-failed", () =>
        saveDigestContent(db, shell.digestId, { status: "failed" }),
      );
      throw e;
    }
  }
}
