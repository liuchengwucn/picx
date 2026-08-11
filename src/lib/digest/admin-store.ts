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

/**
 * 唯一约束违约识别。drizzle 把底层错误包成 DrizzleQueryError，其 message 里带着
 * 整条 SQL 与全部绑定参数（含管理员刚输入的 focusBrief 全文）——那条消息一个字都
 * 不能回传前端，真正的 "UNIQUE constraint failed" 只在 cause 链上，故逐层下钻。
 */
function isUniqueConstraintError(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; cur instanceof Error && depth < 5; depth++) {
    if (/UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(cur.message))
      return true;
    cur = cur.cause;
  }
  return false;
}

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

export type UpsertDirectionResult =
  | { id: string }
  | { error: "slug_taken" | "not_found" };

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
): Promise<UpsertDirectionResult> {
  // slug 查重两个分支共用：新建时 input.id 为 undefined，恒不等于任何已有 id
  const [dup] = await db
    .select({ id: directions.id })
    .from(directions)
    .where(eq(directions.slug, input.slug))
    .limit(1);
  if (dup && dup.id !== input.id) return { error: "slug_taken" };

  if (input.id) {
    // 匹配 0 行的 UPDATE 不报错：另一个标签页刚把这个方向删了的话，
    // 不检查存在性就会「保存成功」但库里什么都没变
    const [existing] = await db
      .select({ id: directions.id })
      .from(directions)
      .where(eq(directions.id, input.id))
      .limit(1);
    if (!existing) return { error: "not_found" };
    try {
      await db
        .update(directions)
        .set({
          slug: input.slug,
          name: input.name,
          focusBrief: input.focusBrief,
          ...(input.intro !== undefined ? { intro: input.intro } : {}),
          isActive: input.isActive,
          sortOrder: input.sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(directions.id, input.id));
    } catch (e) {
      return rethrowAsDirectionError(e, "update");
    }
    return { id: input.id };
  }

  // 可读固定 id，与 seed 脚本（scripts/seed-directions.sql）的 dir-{slug} 约定一致。
  // 但 id 一经写入就不再随 slug 改名而变，所以「建 alpha → 改名 beta → 再建 alpha」
  // 会让 slug 查重放行、主键却已被占用，故 PK 撞车时退化成带随机后缀的 id。
  let id = `dir-${input.slug}`;
  const [pkTaken] = await db
    .select({ id: directions.id })
    .from(directions)
    .where(eq(directions.id, id))
    .limit(1);
  if (pkTaken) id = `${id}-${crypto.randomUUID().slice(0, 8)}`;
  try {
    await db.insert(directions).values({
      id,
      slug: input.slug,
      name: input.name,
      focusBrief: input.focusBrief,
      intro: input.intro ?? null,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    });
  } catch (e) {
    return rethrowAsDirectionError(e, "insert");
  }
  return { id };
}

/**
 * 上面两处 catch 的共用出口：唯一约束违约（查重与写入之间的并发窗口，
 * directions_slug_unique 兜底）翻译成 slug_taken，其余错误只进日志，
 * 抛给 router 的是不含 SQL 与绑定参数的干净消息。
 */
function rethrowAsDirectionError(
  e: unknown,
  op: "insert" | "update",
): { error: "slug_taken" } {
  if (isUniqueConstraintError(e)) return { error: "slug_taken" };
  console.error(`[admin-store] upsertDirection ${op} failed:`, e);
  throw new Error("failed to persist direction");
}

export type DeleteDirectionResult =
  | { deleted: true }
  | { deleted: false; reason: "not_found" | "still_active" | "has_history" };

/**
 * 物理删除防呆：有任何 digests 或关联 papers 的方向只能停用。
 *
 * 还要求方向已停用：两次 COUNT 与 DELETE 之间存在真实的并发窗口——在飞的
 * digest workflow 可能刚 ensureDigestShell 插入 digest 行，被 DELETE 级联带走后，
 * 后续往已消失的 digest 插 digest_papers 会撞外键、step 反复重试到耗尽。
 * digest-cron.ts:17 只捞 active 方向，所以「先停用、观察一周、再删」即可封堵。
 *
 * 删除本身是单语句：direction_sources / direction_candidates 的外键都是
 * ON DELETE cascade（drizzle/0029），papers.direction_id 是 SET NULL，
 * 一条 DELETE 原子带走一切，不需要手工删子表（D1 无事务，手工删反而造出中断窗口）。
 */
export async function deleteDirectionGuarded(
  db: Db,
  directionId: string,
): Promise<DeleteDirectionResult> {
  const [dir] = await db
    .select({ isActive: directions.isActive })
    .from(directions)
    .where(eq(directions.id, directionId))
    .limit(1);
  if (!dir) return { deleted: false, reason: "not_found" };
  if (dir.isActive) return { deleted: false, reason: "still_active" };

  const [digestRow] = await db
    .select({ value: count() })
    .from(digests)
    .where(eq(digests.directionId, directionId));
  const [paperRow] = await db
    .select({ value: count() })
    .from(papers)
    .where(eq(papers.directionId, directionId));
  if ((digestRow?.value ?? 0) > 0 || (paperRow?.value ?? 0) > 0)
    return { deleted: false, reason: "has_history" };

  await db.delete(directions).where(eq(directions.id, directionId));
  return { deleted: true };
}

/** 更新分支刻意不改 directionId：源不能在方向之间搬家，要换方向请删了重建 */
export async function upsertSource(
  db: Db,
  input: {
    id?: string;
    directionId: string;
    adapterType: "arxiv_query" | "rss";
    config: DirectionSourceConfig;
    enabled: boolean;
  },
): Promise<{ id: string } | { error: "not_found" }> {
  if (input.id) {
    // 与 upsertDirection 同理：匹配 0 行的 UPDATE 不能报告成功
    const [existing] = await db
      .select({ id: directionSources.id })
      .from(directionSources)
      .where(eq(directionSources.id, input.id))
      .limit(1);
    if (!existing) return { error: "not_found" };
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
  /** triggerDigest 吃的是 id，带上省得前端再从 listDirections 反查一次 slug→id */
  directionId: string;
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
    result.push(
      ...rows.map((r) => ({ ...r, directionId: d.id, directionSlug: d.slug })),
    );
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
