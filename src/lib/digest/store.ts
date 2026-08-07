// src/lib/digest/store.ts
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
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
  papers,
} from "#/db/schema";
import { canonicalArxivId, canonicalArxivUrl } from "#/lib/arxiv";
import { createGalleryPaper, ensureGuestUser } from "#/lib/gallery-paper";
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

  const poolRows = await db
    .select({
      canonicalUrl: directionCandidates.canonicalUrl,
      status: directionCandidates.status,
      score: directionCandidates.score,
    })
    .from(directionCandidates)
    .where(eq(directionCandidates.directionId, directionId));

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

/** 源健康回写（成功/失败），字段语义与 news_sources 一致 */
export async function recordSourceResult(
  db: Db,
  sourceId: string,
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
      })
      .where(eq(directionSources.id, sourceId));
  } else {
    await db
      .update(directionSources)
      .set({
        lastAttemptAt: now,
        lastError: result.error.slice(0, 500),
        consecutiveFailures: sql`${directionSources.consecutiveFailures} + 1`,
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

/** 供 workflow 里把 angle/搜索产出的 arXiv 链接规范化 */
export function canonicalizeCandidate(item: CandidateItem): CandidateItem {
  const id = canonicalArxivId(item.canonicalUrl);
  if (id) {
    return { ...item, canonicalUrl: canonicalArxivUrl(id), kind: "paper" };
  }
  return item;
}
