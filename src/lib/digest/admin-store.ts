// src/lib/digest/admin-store.ts
// 管理面内部查询/写入。与 store.ts 的「Phase 2 公开区块」刻意分文件：那边的硬约束
// 是 published-only + 内部字段一律不 select；这边恰恰要读 status / workflowInstanceId /
// proposedFocusUpdate。绝不从公开 router 调这里的任何函数。
import { asc, count, desc, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import {
  type DirectionSourceConfig,
  digests,
  directionSources,
  directions,
  paperFeedback,
  papers,
  user,
} from "#/db/schema";

type Db = ReturnType<typeof drizzle>;

export interface AdminSource {
  id: string;
  adapterType: "arxiv_query" | "rss";
  config: DirectionSourceConfig;
  enabled: boolean;
  consecutiveFailures: number;
  lastError: string | null;
  lastAttemptAt: Date | null;
  lastFetchedAt: Date | null;
}

export interface AdminDirection {
  id: string;
  slug: string;
  name: Record<string, string>;
  focusBrief: string;
  intro: Record<string, string> | null;
  isActive: boolean;
  sortOrder: number;
  sources: AdminSource[];
}

export async function listDirectionsAdmin(db: Db): Promise<AdminDirection[]> {
  const dirs = await db
    .select()
    .from(directions)
    .orderBy(asc(directions.sortOrder), asc(directions.slug));
  const sources = await db.select().from(directionSources);
  return dirs.map((d) => ({
    id: d.id,
    slug: d.slug,
    name: d.name,
    focusBrief: d.focusBrief,
    intro: d.intro,
    isActive: d.isActive,
    sortOrder: d.sortOrder,
    sources: sources
      .filter((s) => s.directionId === d.id)
      .map((s) => ({
        id: s.id,
        adapterType: s.adapterType,
        config: s.config,
        enabled: s.enabled,
        consecutiveFailures: s.consecutiveFailures,
        lastError: s.lastError,
        lastAttemptAt: s.lastAttemptAt,
        lastFetchedAt: s.lastFetchedAt,
      })),
  }));
}

export async function upsertDirection(
  db: Db,
  input: {
    id?: string;
    slug: string;
    name: Record<string, string>;
    focusBrief: string;
    intro?: Record<string, string> | null;
    isActive: boolean;
    sortOrder: number;
  },
): Promise<{ id: string } | { error: "slug_taken" }> {
  const now = new Date();
  if (input.id) {
    const [dup] = await db
      .select({ id: directions.id })
      .from(directions)
      .where(eq(directions.slug, input.slug))
      .limit(1);
    if (dup && dup.id !== input.id) return { error: "slug_taken" };
    await db
      .update(directions)
      .set({
        slug: input.slug,
        name: input.name,
        focusBrief: input.focusBrief,
        ...(input.intro !== undefined ? { intro: input.intro } : {}),
        isActive: input.isActive,
        sortOrder: input.sortOrder,
        updatedAt: now,
      })
      .where(eq(directions.id, input.id));
    return { id: input.id };
  }
  const [dup] = await db
    .select({ id: directions.id })
    .from(directions)
    .where(eq(directions.slug, input.slug))
    .limit(1);
  if (dup) return { error: "slug_taken" };
  // 可读固定 id，与 seed 脚本（scripts/seed-directions.sql）的 dir-{slug} 约定一致
  const id = `dir-${input.slug}`;
  await db.insert(directions).values({
    id,
    slug: input.slug,
    name: input.name,
    focusBrief: input.focusBrief,
    intro: input.intro ?? null,
    isActive: input.isActive,
    sortOrder: input.sortOrder,
  });
  return { id };
}

/** 物理删除防呆：有任何 digests 或关联 papers 的方向只能停用 */
export async function deleteDirectionGuarded(
  db: Db,
  directionId: string,
): Promise<{ deleted: boolean }> {
  const [digestRow] = await db
    .select({ value: count() })
    .from(digests)
    .where(eq(digests.directionId, directionId));
  const [paperRow] = await db
    .select({ value: count() })
    .from(papers)
    .where(eq(papers.directionId, directionId));
  if ((digestRow?.value ?? 0) > 0 || (paperRow?.value ?? 0) > 0)
    return { deleted: false };
  // D1 无事务：先删子表再删主表，中断的最坏情形是「源没了、方向还在」，可重试
  await db
    .delete(directionSources)
    .where(eq(directionSources.directionId, directionId));
  await db.delete(directions).where(eq(directions.id, directionId));
  return { deleted: true };
}

export async function upsertSource(
  db: Db,
  input: {
    id?: string;
    directionId: string;
    adapterType: "arxiv_query" | "rss";
    config: DirectionSourceConfig;
    enabled: boolean;
  },
): Promise<{ id: string }> {
  if (input.id) {
    await db
      .update(directionSources)
      .set({
        adapterType: input.adapterType,
        config: input.config,
        enabled: input.enabled,
      })
      .where(eq(directionSources.id, input.id));
    return { id: input.id };
  }
  const id = `dsrc-${crypto.randomUUID().slice(0, 8)}`;
  await db.insert(directionSources).values({
    id,
    directionId: input.directionId,
    adapterType: input.adapterType,
    config: input.config,
    enabled: input.enabled,
  });
  return { id };
}

export async function deleteSource(db: Db, sourceId: string): Promise<void> {
  await db.delete(directionSources).where(eq(directionSources.id, sourceId));
}

/** 熔断源手动复活：清零失败计数并重新启用 */
export async function reviveSource(db: Db, sourceId: string): Promise<void> {
  await db
    .update(directionSources)
    .set({ enabled: true, consecutiveFailures: 0, lastError: null })
    .where(eq(directionSources.id, sourceId));
}

export interface AdminDigestRow {
  digestId: string;
  directionSlug: string;
  issueNumber: number;
  status: "generating" | "published" | "failed";
  periodStart: Date;
  periodEnd: Date;
  publishedAt: Date | null;
  workflowInstanceId: string;
  proposedFocusUpdateStatus: "pending" | "adopted" | "dismissed" | null;
}

/** 每方向最近 10 期（含 generating/failed 与内部字段）。N+1 可接受：方向个位数 */
export async function listRecentDigestsAdmin(
  db: Db,
): Promise<AdminDigestRow[]> {
  const dirs = await db
    .select({ id: directions.id, slug: directions.slug })
    .from(directions)
    .orderBy(asc(directions.sortOrder), asc(directions.slug));
  const result: AdminDigestRow[] = [];
  for (const d of dirs) {
    const rows = await db
      .select({
        digestId: digests.id,
        issueNumber: digests.issueNumber,
        status: digests.status,
        periodStart: digests.periodStart,
        periodEnd: digests.periodEnd,
        publishedAt: digests.publishedAt,
        workflowInstanceId: digests.workflowInstanceId,
        proposedFocusUpdateStatus: digests.proposedFocusUpdateStatus,
      })
      .from(digests)
      .where(eq(digests.directionId, d.id))
      .orderBy(desc(digests.issueNumber))
      .limit(10);
    result.push(...rows.map((r) => ({ ...r, directionSlug: d.slug })));
  }
  return result;
}

export interface AdminFeedbackRow {
  paperTitle: string;
  paperShortId: string;
  userName: string;
  vote: number;
  reasonPreset: string | null;
  reasonText: string | null;
  updatedAt: Date;
}

/** 全站最近 50 条反馈（管理页展示；与 store.ts 按方向喂 LLM 的那条查询职责不同） */
export async function listRecentFeedbackAdmin(
  db: Db,
): Promise<AdminFeedbackRow[]> {
  return db
    .select({
      paperTitle: papers.title,
      paperShortId: papers.shortId,
      userName: user.name,
      vote: paperFeedback.vote,
      reasonPreset: paperFeedback.reasonPreset,
      reasonText: paperFeedback.reasonText,
      updatedAt: paperFeedback.updatedAt,
    })
    .from(paperFeedback)
    .innerJoin(papers, eq(paperFeedback.paperId, papers.id))
    .innerJoin(user, eq(paperFeedback.userId, user.id))
    .orderBy(desc(paperFeedback.updatedAt))
    .limit(50);
}
