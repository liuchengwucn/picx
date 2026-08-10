// src/lib/digest/store.ts
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import {
  type DirectionSourceConfig,
  digestPapers,
  digests,
  directionCandidates,
  directionSources,
  directions,
  hfSignals,
  paperFeedback,
  paperResults,
  papers,
  whiteboardImages,
} from "#/db/schema";
import { canonicalArxivId, canonicalArxivUrl } from "#/lib/arxiv";
import { createGalleryPaper, ensureGuestUser } from "#/lib/gallery-paper";
import { MAX_SOURCE_FAILURES } from "#/lib/news/source-health";
import { likeCountSql } from "#/lib/paper-feedback";
import type { Env } from "#/types/env";
import type { PoolEntry } from "./candidates";
import type {
  CandidateItem,
  FeedbackSample,
  ReviewedCandidate,
  SynthesisPick,
} from "./types";

type Db = ReturnType<typeof drizzle>;

export interface DirectionContext {
  direction: {
    id: string;
    slug: string;
    name: Record<string, string>;
    focusBrief: string;
  };
  sources: Array<{
    id: string;
    adapterType: "arxiv_query" | "rss";
    config: DirectionSourceConfig;
    enabled: boolean;
    consecutiveFailures: number;
    lastAttemptAt: Date | null;
  }>;
  feedback: FeedbackSample[];
  pool: PoolEntry[];
  /** arxivId → upvotes，近 14 天 */
  hfUpvotesByArxivId: Array<[string, number]>;
}

export async function loadDirectionContext(
  db: Db,
  directionId: string,
): Promise<DirectionContext> {
  const [direction] = await db
    .select()
    .from(directions)
    .where(eq(directions.id, directionId))
    .limit(1);
  if (!direction) throw new Error(`direction not found: ${directionId}`);

  const sources = await db
    .select()
    .from(directionSources)
    .where(eq(directionSources.directionId, directionId));

  // 该方向论文的近 50 条反馈（带理由优先靠前不必强求，按时间取最近即可）
  const feedbackRows = await db
    .select({
      paperTitle: papers.title,
      vote: paperFeedback.vote,
      reasonPreset: paperFeedback.reasonPreset,
      reasonText: paperFeedback.reasonText,
    })
    .from(paperFeedback)
    .innerJoin(papers, eq(paperFeedback.paperId, papers.id))
    .where(eq(papers.directionId, directionId))
    .orderBy(desc(paperFeedback.updatedAt))
    .limit(50);

  // 候选池会无限增长（从不删除），全量读回有撞 workflow 1MiB step-return 上限的风险。
  // recommended 必须永久保留——否则已发布论文可能在后续期数被重新选中；
  // 其余 seen/rejected 超过 180 天允许被遗忘，最坏情形只是白白重评一次、大概率仍会被拒。
  const poolCutoff = new Date(Date.now() - 180 * 86400_000);
  const poolRows = await db
    .select({
      canonicalUrl: directionCandidates.canonicalUrl,
      status: directionCandidates.status,
      score: directionCandidates.score,
    })
    .from(directionCandidates)
    .where(
      and(
        eq(directionCandidates.directionId, directionId),
        or(
          eq(directionCandidates.status, "recommended"),
          gte(directionCandidates.lastSeenAt, poolCutoff),
        ),
      ),
    );

  const since = new Date(Date.now() - 14 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const signalRows = await db
    .select({ arxivId: hfSignals.arxivId, upvotes: hfSignals.upvotes })
    .from(hfSignals)
    .where(gte(hfSignals.date, since));

  return {
    direction: {
      id: direction.id,
      slug: direction.slug,
      name: direction.name,
      focusBrief: direction.focusBrief,
    },
    sources: sources.map((s) => ({
      id: s.id,
      adapterType: s.adapterType,
      config: s.config,
      enabled: s.enabled,
      consecutiveFailures: s.consecutiveFailures,
      lastAttemptAt: s.lastAttemptAt,
    })),
    feedback: feedbackRows,
    pool: poolRows,
    hfUpvotesByArxivId: signalRows.map((r) => [r.arxivId, r.upvotes]),
  };
}

/** 幂等创建本期 digest 行（workflowInstanceId unique 守卫），返回 digestId 与期号 */
export async function ensureDigestShell(
  db: Db,
  input: {
    directionId: string;
    workflowInstanceId: string;
    periodStart: Date;
    periodEnd: Date;
  },
): Promise<{ digestId: string; issueNumber: number }> {
  const [existing] = await db
    .select({ id: digests.id, issueNumber: digests.issueNumber })
    .from(digests)
    .where(eq(digests.workflowInstanceId, input.workflowInstanceId))
    .limit(1);
  if (existing)
    return { digestId: existing.id, issueNumber: existing.issueNumber };

  const [row] = await db
    .select({ max: sql<number | null>`max(${digests.issueNumber})` })
    .from(digests)
    .where(eq(digests.directionId, input.directionId));
  const issueNumber = (row?.max ?? 0) + 1;
  const digestId = crypto.randomUUID();
  await db.insert(digests).values({
    id: digestId,
    directionId: input.directionId,
    issueNumber,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    status: "generating",
    workflowInstanceId: input.workflowInstanceId,
  });
  return { digestId, issueNumber };
}

/**
 * 源健康回写（成功/失败），字段语义与 news_sources / source-health 一致。
 * currentFailures 由调用方传入（workflow 手上就有，来自 loadDirectionContext）；
 * 失败计数写绝对值而非 `col + 1` 的相对表达式，使本函数在 step 重试下天然幂等，
 * 同时据此维护 enabled：达到 MAX_SOURCE_FAILURES 即熔断，探活/常规抓取成功即自愈。
 */
export async function recordSourceResult(
  db: Db,
  sourceId: string,
  currentFailures: number,
  result: { ok: true } | { ok: false; error: string },
): Promise<void> {
  const now = new Date();
  if (result.ok) {
    await db
      .update(directionSources)
      .set({
        lastFetchedAt: now,
        lastAttemptAt: now,
        lastError: null,
        consecutiveFailures: 0,
        // 探活成功即自愈；对本来就健康的源是 no-op
        enabled: true,
      })
      .where(eq(directionSources.id, sourceId));
  } else {
    const failures = currentFailures + 1;
    await db
      .update(directionSources)
      .set({
        lastAttemptAt: now,
        lastError: result.error.slice(0, 500),
        consecutiveFailures: failures,
        enabled: failures < MAX_SOURCE_FAILURES,
      })
      .where(eq(directionSources.id, sourceId));
  }
}

/** 本期见过的候选逐条 upsert 进池（新候选 insert，已有的仅刷新 lastSeenAt）。幂等。 */
export async function upsertCandidatesSeen(
  db: Db,
  directionId: string,
  items: CandidateItem[],
): Promise<void> {
  const now = new Date();
  for (const item of items) {
    await db
      .insert(directionCandidates)
      .values({
        directionId,
        canonicalUrl: item.canonicalUrl,
        title: item.title.slice(0, 500),
        kind: item.kind,
        status: "seen",
        sourceMeta: { sourceLabel: item.sourceLabel },
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [
          directionCandidates.directionId,
          directionCandidates.canonicalUrl,
        ],
        set: { lastSeenAt: now },
      });
  }
}

/** 评审/验证后的状态回写（rejected 或 seen+score）。幂等（重复 update 无害）。 */
export async function updateCandidateStatus(
  db: Db,
  directionId: string,
  canonicalUrl: string,
  patch: { status?: "seen" | "recommended" | "rejected"; score?: number },
): Promise<void> {
  await db
    .update(directionCandidates)
    .set({ ...patch, lastSeenAt: new Date() })
    .where(
      and(
        eq(directionCandidates.directionId, directionId),
        eq(directionCandidates.canonicalUrl, canonicalUrl),
      ),
    );
}

export interface FinalizeResult {
  paperIds: string[]; // 本期关联的全部 paperId（含已存在的）
  createdCount: number;
}

/**
 * 定稿落库：picks → 建论文（走 MinerU/白板队列）→ digest_papers → 候选池标 recommended。
 * 整体幂等：createGalleryPaper 查重、digest_papers 先删后插、候选 update 无害。
 */
export async function finalizeDigestPapers(
  db: Db,
  env: Env,
  input: {
    digestId: string;
    directionId: string;
    directionSlug: string;
    issueNumber: number;
    picks: SynthesisPick[];
    reviewedByUrl: Map<string, ReviewedCandidate>;
    notesByUrl: Map<string, Record<string, string>>; // 四语推荐语（翻译步产出）
  },
): Promise<FinalizeResult> {
  await ensureGuestUser(db);
  await db
    .delete(digestPapers)
    .where(eq(digestPapers.digestId, input.digestId));

  // 去重：picks 按 rank 排序到达，先到者 rank 更优；重复 URL 会撞 digest_papers 的
  // (digestId, paperId) 主键并让整个 finalize step 反复失败（详见协调者反馈）。
  const seenUrls = new Set<string>();
  const dedupedPicks: SynthesisPick[] = [];
  for (const pick of input.picks) {
    if (seenUrls.has(pick.canonicalUrl)) {
      console.warn(
        `[finalizeDigestPapers] duplicate pick canonicalUrl dropped: digestId=${input.digestId} url=${pick.canonicalUrl}`,
      );
      continue;
    }
    seenUrls.add(pick.canonicalUrl);
    dedupedPicks.push(pick);
  }

  const paperIds: string[] = [];
  const seenPaperIds = new Set<string>();
  let createdCount = 0;
  for (const pick of dedupedPicks) {
    const reviewed = input.reviewedByUrl.get(pick.canonicalUrl);
    const title = reviewed?.item.title ?? pick.canonicalUrl;
    const { created, paperId } = await createGalleryPaper(db, env, {
      arxivUrl: pick.canonicalUrl,
      title,
      upvotes: reviewed?.item.hfUpvotes ?? null,
      directionId: input.directionId,
      creditDescription: `Digest ${input.directionSlug}#${input.issueNumber}: ${title}`,
    });
    if (!paperId) continue;
    // 二次防护：不同 canonicalUrl 若因上游规范化不一致最终解析到同一 paperId
    // （createGalleryPaper 按 sourceUrl 查重），也不能重复插入同一 (digestId, paperId)。
    if (seenPaperIds.has(paperId)) {
      console.warn(
        `[finalizeDigestPapers] duplicate resolved paperId dropped: digestId=${input.digestId} paperId=${paperId} url=${pick.canonicalUrl}`,
      );
      continue;
    }
    seenPaperIds.add(paperId);
    if (created) createdCount++;
    paperIds.push(paperId);
    await db.insert(digestPapers).values({
      digestId: input.digestId,
      paperId,
      rank: pick.rank,
      recommendationNote: input.notesByUrl.get(pick.canonicalUrl) ?? {
        "zh-cn": pick.recommendationNote,
      },
    });
    await updateCandidateStatus(db, input.directionId, pick.canonicalUrl, {
      status: "recommended",
    });
  }
  return { paperIds, createdCount };
}

/** 本期论文处理进度：全部离开 pending/parsing/processing_* 即算就绪 */
export async function countUnfinishedPapers(
  db: Db,
  paperIds: string[],
): Promise<number> {
  if (paperIds.length === 0) return 0;
  // D1 绑定参数上限 100：paperIds 本期 ≤10，安全
  const rows = await db
    .select({ status: papers.status })
    .from(papers)
    .where(inArray(papers.id, paperIds));
  return rows.filter((r) => r.status !== "completed" && r.status !== "failed")
    .length;
}

/** 兜底发布前的可见性检查：返回仍未完成的论文 id，供 console.warn 定位具体是哪几篇 */
export async function findUnfinishedPaperIds(
  db: Db,
  paperIds: string[],
): Promise<string[]> {
  if (paperIds.length === 0) return [];
  const rows = await db
    .select({ id: papers.id, status: papers.status })
    .from(papers)
    .where(inArray(papers.id, paperIds));
  return rows
    .filter((r) => r.status !== "completed" && r.status !== "failed")
    .map((r) => r.id);
}

export async function saveDigestContent(
  db: Db,
  digestId: string,
  patch: {
    title?: Record<string, string>;
    content?: Record<string, string>;
    proposedFocusUpdate?: string | null;
    status?: "generating" | "published" | "failed";
    publishedAt?: Date;
  },
): Promise<void> {
  await db
    .update(digests)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(digests.id, digestId));
}

/** 论文候选允许的最大月龄：只报近 6 个月的工作（老论文可晚受关注，但两年前的旧闻不报） */
export const MAX_PAPER_AGE_MONTHS = 6;

/**
 * 供 workflow 里把角度搜索产出的候选按 URL 权威定性 kind：gallery 入库路径
 * （createGalleryPaper / 队列 PDF 下载）只认 arXiv，"paper" 必须是代码能兑现的
 * 承诺，而不是模型的主观判断——命中 arXiv 才规范化 URL 并置 kind:"paper"；
 * 否则无论模型标了什么，强制降级为 "intel"，避免 OpenReview/exa.ai 等无法
 * 处理的来源被当作论文建卡后永远处理失败。
 * 同时做新鲜度硬裁定（prompt 约束模型不可靠）：arXiv ID 自带 yymm，超过
 * MAX_PAPER_AGE_MONTHS 直接返回 null 丢弃——旧论文降级成 intel 报出来也还是旧闻。
 * 旧式 ID（math/0601001）全部早于 2008 年，一律丢弃。
 */
export function canonicalizeCandidate(
  item: CandidateItem,
  periodEnd: Date,
): CandidateItem | null {
  const id = canonicalArxivId(item.canonicalUrl);
  if (!id) return { ...item, kind: "intel" };
  const m = id.match(/^(\d{2})(\d{2})\./);
  if (!m) return null; // 旧式 arXiv ID，必然超龄
  const paperYear = 2000 + Number(m[1]);
  const paperMonth = Number(m[2]);
  if (paperMonth < 1 || paperMonth > 12) return null; // 伪 arXiv ID（canonicalArxivId 未锚定正则的误匹配）
  const monthsDiff =
    (periodEnd.getUTCFullYear() - paperYear) * 12 +
    (periodEnd.getUTCMonth() + 1 - paperMonth);
  if (monthsDiff > MAX_PAPER_AGE_MONTHS) return null;
  return { ...item, canonicalUrl: canonicalArxivUrl(id), kind: "paper" };
}

// ==================== Phase 2 读查询（公开页面用） ====================
// 只暴露 published 内容；proposedFocusUpdate / workflowInstanceId 等内部字段
// 一律不 select，泄漏防护从 store 层就位。

export interface DirectionSummary {
  slug: string;
  name: Record<string, string>;
  latestIssue: {
    issueNumber: number;
    title: Record<string, string> | null;
    publishedAt: Date | null;
  } | null;
}

export async function listActiveDirections(
  db: Db,
): Promise<DirectionSummary[]> {
  const dirs = await db
    .select({ id: directions.id, slug: directions.slug, name: directions.name })
    .from(directions)
    .where(eq(directions.isActive, true))
    .orderBy(asc(directions.sortOrder), asc(directions.slug));
  // N+1 可接受：方向数量是个位数
  const result: DirectionSummary[] = [];
  for (const d of dirs) {
    const [latest] = await db
      .select({
        issueNumber: digests.issueNumber,
        title: digests.title,
        publishedAt: digests.publishedAt,
      })
      .from(digests)
      .where(
        and(eq(digests.directionId, d.id), eq(digests.status, "published")),
      )
      .orderBy(desc(digests.issueNumber))
      .limit(1);
    result.push({ slug: d.slug, name: d.name, latestIssue: latest ?? null });
  }
  return result;
}

export interface DirectionDetail {
  slug: string;
  name: Record<string, string>;
  focusBrief: string;
  issues: Array<{
    issueNumber: number;
    title: Record<string, string> | null;
    publishedAt: Date | null;
    periodStart: Date;
    periodEnd: Date;
  }>;
  /** 最新一期正文（大卡摘要用；无 published 期为 null） */
  latestContent: Record<string, string> | null;
}

export async function getDirectionDetailBySlug(
  db: Db,
  slug: string,
): Promise<DirectionDetail | null> {
  const [dir] = await db
    .select({
      id: directions.id,
      slug: directions.slug,
      name: directions.name,
      focusBrief: directions.focusBrief,
    })
    .from(directions)
    .where(and(eq(directions.slug, slug), eq(directions.isActive, true)))
    .limit(1);
  if (!dir) return null;
  const issues = await db
    .select({
      issueNumber: digests.issueNumber,
      title: digests.title,
      publishedAt: digests.publishedAt,
      periodStart: digests.periodStart,
      periodEnd: digests.periodEnd,
    })
    .from(digests)
    .where(
      and(eq(digests.directionId, dir.id), eq(digests.status, "published")),
    )
    .orderBy(desc(digests.issueNumber));
  // 正文只取最新一期（列表页不需要历史期的 4 倍 markdown）
  let latestContent: Record<string, string> | null = null;
  if (issues.length > 0) {
    const [latest] = await db
      .select({ content: digests.content })
      .from(digests)
      .where(
        and(
          eq(digests.directionId, dir.id),
          eq(digests.issueNumber, issues[0].issueNumber),
          eq(digests.status, "published"),
        ),
      )
      .limit(1);
    latestContent = latest?.content ?? null;
  }
  return {
    slug: dir.slug,
    name: dir.name,
    focusBrief: dir.focusBrief,
    issues,
    latestContent,
  };
}

export interface IssueDetail {
  directionSlug: string;
  directionName: Record<string, string>;
  issueNumber: number;
  title: Record<string, string> | null;
  content: Record<string, string> | null;
  periodStart: Date;
  periodEnd: Date;
  publishedAt: Date | null;
  papers: Array<{
    /** getMyFeedback 批量查询与反馈按钮用；papers.id 在 listPublic 公开响应里本就存在 */
    id: string;
    shortId: string | null;
    title: string;
    tldr: Record<string, string> | null;
    /** 超时兜底发布的期可能有未完成白板管线的论文 —— leftJoin，可为 null */
    whiteboardImageR2Key: string | null;
    recommendationNote: Record<string, string> | null;
    rank: number;
    likeCount: number;
  }>;
  prevIssue: number | null;
  nextIssue: number | null;
}

/**
 * isActive 与 listActiveDirections / getDirectionDetailBySlug 同一条件, 不是可省的:
 * 少了它, 下线方向的 tab 与主页都没了(那两个函数都过滤), 期页却仍 200 出全文, 且
 * 页脚「返回方向页」链到一个 404。方向下线 = 连历史期一起隐藏, 期页也 404, 并从
 * sitemap / llms.txt / llms-full.txt 一起移除(那三处各自手写同一条 join, 要同步改)。
 */
export async function getPublishedIssueDetail(
  db: Db,
  slug: string,
  issueNumber: number,
): Promise<IssueDetail | null> {
  const [row] = await db
    .select({
      digestId: digests.id,
      directionId: digests.directionId,
      directionSlug: directions.slug,
      directionName: directions.name,
      issueNumber: digests.issueNumber,
      title: digests.title,
      content: digests.content,
      periodStart: digests.periodStart,
      periodEnd: digests.periodEnd,
      publishedAt: digests.publishedAt,
    })
    .from(digests)
    .innerJoin(directions, eq(digests.directionId, directions.id))
    .where(
      and(
        eq(directions.slug, slug),
        eq(directions.isActive, true),
        eq(digests.issueNumber, issueNumber),
        eq(digests.status, "published"),
      ),
    )
    .limit(1);
  if (!row) return null;

  // 白板图 leftJoin（与 gallery 流的 innerJoin 刻意不同）：期内论文清单必须完整，
  // 无图论文由前端降级为纯文字卡。groupBy 防重复默认白板/重复 paper_results 扇出。
  // 可见性守卫只挡软删（软删论文的 /p/$shortId 已 404，链过去是死链）：
  // status="completed" 恰恰是 leftJoin 要兜住的降级场景（兜底发布的期会有白板管线
  // 未完成的论文，仍须出现在清单里）；isPublic / isListedInGallery 的下架语义留给
  // Phase 3 管理页决策，此处加会与「期内论文清单必须完整」冲突。
  const paperRows = await db
    .select({
      id: papers.id,
      shortId: papers.shortId,
      title: papers.title,
      tldr: paperResults.tldr,
      whiteboardImageR2Key: whiteboardImages.imageR2Key,
      recommendationNote: digestPapers.recommendationNote,
      rank: digestPapers.rank,
      // 多表查询, 满足 likeCountSql 的前提（单表会被剥表限定符）
      likeCount: likeCountSql(papers.id),
    })
    .from(digestPapers)
    .innerJoin(papers, eq(digestPapers.paperId, papers.id))
    .leftJoin(
      whiteboardImages,
      and(
        eq(whiteboardImages.paperId, papers.id),
        eq(whiteboardImages.isDefault, true),
      ),
    )
    .leftJoin(paperResults, eq(paperResults.paperId, papers.id))
    .where(
      and(eq(digestPapers.digestId, row.digestId), isNull(papers.deletedAt)),
    )
    .groupBy(papers.id)
    .orderBy(asc(digestPapers.rank));

  const [prev] = await db
    .select({ issueNumber: digests.issueNumber })
    .from(digests)
    .where(
      and(
        eq(digests.directionId, row.directionId),
        eq(digests.status, "published"),
        lt(digests.issueNumber, issueNumber),
      ),
    )
    .orderBy(desc(digests.issueNumber))
    .limit(1);
  const [next] = await db
    .select({ issueNumber: digests.issueNumber })
    .from(digests)
    .where(
      and(
        eq(digests.directionId, row.directionId),
        eq(digests.status, "published"),
        gt(digests.issueNumber, issueNumber),
      ),
    )
    .orderBy(asc(digests.issueNumber))
    .limit(1);

  return {
    directionSlug: row.directionSlug,
    directionName: row.directionName,
    issueNumber: row.issueNumber,
    title: row.title,
    content: row.content,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    publishedAt: row.publishedAt,
    papers: paperRows,
    prevIssue: prev?.issueNumber ?? null,
    nextIssue: next?.issueNumber ?? null,
  };
}
