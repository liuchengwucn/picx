// src/lib/digest/admin-store.ts
// 管理面内部查询/写入。与 store.ts 的「Phase 2 公开区块」刻意分文件：那边的硬约束
// 是 published-only + 内部字段一律不 select；这边恰恰要读 status / workflowInstanceId /
// proposedFocusUpdate。绝不从公开 router 调这里的任何函数。
import { and, asc, count, desc, eq, ne } from "drizzle-orm";
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
 *
 * 同理，那一帧的 message 也不能拿来做**匹配**：focusBrief 里只要出现
 * 「UNIQUE constraint failed」这几个字（讨论错误处理的方向完全会写到），一次与
 * 唯一约束无关的写入失败（NOT NULL、外键……）就会被误判成 slug_taken，真错误还
 * 连日志都不打，排查两头落空。故跳过包装帧，只在被包装的原始错误上匹配。
 *
 * 匹配 message 而不是错误码：node:sqlite / D1 的 code 都是笼统的 ERR_SQLITE_ERROR
 * （任何 SQLite 错误都是它），按 code 判等于把所有写入失败都说成 slug_taken；
 * 只有原始 message 才区分得出是哪条约束。
 */
function isWrappedQueryError(e: Error): boolean {
  // DrizzleQueryError 不设 this.name（e.name 就是 "Error"），构造函数名又扛不住
  // 打包压缩，所以按它独有的字段结构识别：message = `Failed query: ${query}\nparams: ${params}`
  const { query, params } = e as { query?: unknown; params?: unknown };
  return typeof query === "string" && Array.isArray(params);
}

function isUniqueConstraintError(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; cur instanceof Error && depth < 5; depth++) {
    if (
      !isWrappedQueryError(cur) &&
      /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(cur.message)
    )
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
  /**
   * 管理页表单的陈旧令牌。展开中的编辑表单是「草稿」——本地 state 不会随 refetch
   * 跟着变（否则会抹掉正在输入的内容），于是「采纳提案」这类改了 focusBrief 的
   * 旁路写入之后，表单里仍是旧全文，一保存就把刚采纳的演化整段覆盖回去。
   * 前端拿这个时间戳与挂载时的基线比，不等就锁住保存并请站长重新载入。
   * 采纳（adoptFocusUpdateStore）、intro 重写（setDirectionIntro）、表单保存都会推进它。
   */
  updatedAt: Date;
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
    updatedAt: d.updatedAt,
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
      return mapDirectionWriteError(e, "update");
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
    return mapDirectionWriteError(e, "insert");
  }
  return { id };
}

/**
 * 上面两处 catch 的共用出口：唯一约束违约（查重与写入之间的并发窗口，
 * directions_slug_unique 兜底）翻译成 slug_taken，其余错误只进日志，
 * 抛给 router 的是不含 SQL 与绑定参数的干净消息。
 */
function mapDirectionWriteError(
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
 * 「先停用、观察一周、再删」之所以能封堵这个窗口，靠的是**两处**守卫一起成立：
 * 周更 cron 只捞 active 方向（digest-cron.ts:17），管理台的手动触发也拒绝非 active
 * 方向（admin.ts 的 triggerDigest）。停用之后没有任何入口能再让新实例起飞 —— 新增
 * 起飞入口时必须一并加上 isActive 判定，否则这条论证当场失效。
 *
 * 删除本身是单语句：direction_sources / direction_candidates 的外键都是
 * ON DELETE cascade（drizzle/0029），papers.direction_id 是 SET NULL，
 * 一条 DELETE 原子带走一切，不需要手工删子表（D1 无事务，手工删反而造出中断窗口）。
 *
 * 两个守卫的顺序有意义：has_history 是**永久**判定（历史不会消失，这个方向从此
 * 只能停用），still_active 只是可补救的前置条件。先报 still_active 会把管理员
 * 引去停用——而停用即刻让该方向的全部历史期 404、主页 tab 消失、从 sitemap /
 * llms.txt 移除（store.ts 的公开查询一律 isActive-only）——停完再点删才发现
 * has_history 根本删不掉，公开页白下线一轮。故先 COUNT 后查 isActive。
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

  if (dir.isActive) return { deleted: false, reason: "still_active" };

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
  // 新建同样要查存在性：方向刚在另一个标签页被删掉的话，INSERT 会撞外键，
  // 而那条错误的 message 里拼着整条 SQL 与全部绑定参数，tRPC 会原样回传前端
  const [dir] = await db
    .select({ id: directions.id })
    .from(directions)
    .where(eq(directions.id, input.directionId))
    .limit(1);
  if (!dir) return { error: "not_found" };
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
  /** 分组键。管理页按方向切段展示，不需要 id（触发/删除都从方向表单发起，那里手上就有 id） */
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

export interface PendingProposal {
  digestId: string;
  issueNumber: number;
  proposal: string;
  createdAt: Date;
  /**
   * 该期自身的状态。提案在 finalize 步就落库，而 publish 步最长要轮询论文 3 小时，
   * 期间这期是 generating，编排失败则是 failed——两种情况下提案都照样该审，所以
   * 这条查询刻意不按 published 过滤。但公开侧只认 published，管理页据此决定
   * 「第 N 期」要不要链到 /gallery/d/{slug}/{n}，否则就是一个 404 链接。
   */
  status: "generating" | "published" | "failed";
  directionId: string;
  directionSlug: string;
  directionName: Record<string, string>;
  /** 方向**当前**的 focusBrief，供管理页与提案上下对照 */
  currentFocusBrief: string;
}

/**
 * 待审的 focusBrief 更新提案。listRecentDigestsAdmin 只带 status 不带正文
 * （它是期状态总览，不该为每期拖一段长文），审阅需要全文，故单独一条查询。
 */
export async function listPendingProposals(db: Db): Promise<PendingProposal[]> {
  const rows = await db
    .select({
      digestId: digests.id,
      issueNumber: digests.issueNumber,
      proposal: digests.proposedFocusUpdate,
      createdAt: digests.createdAt,
      status: digests.status,
      // 取 digests 侧的外键而不是 directions.id：innerJoin 下两者恒等，但同名的
      // "id" 列会在结果集里撞名（drizzle 不给 select 里的列自动加别名）
      directionId: digests.directionId,
      directionSlug: directions.slug,
      directionName: directions.name,
      currentFocusBrief: directions.focusBrief,
    })
    .from(digests)
    .innerJoin(directions, eq(digests.directionId, directions.id))
    .where(eq(digests.proposedFocusUpdateStatus, "pending"))
    .orderBy(desc(digests.createdAt));
  // proposal 列类型是 string | null，status='pending' 已蕴含非空（saveDigestContent
  // 只在 trim 后非空时置 pending），这里过滤纯粹是为了把类型收窄成 string
  return rows.flatMap((r) =>
    r.proposal ? [{ ...r, proposal: r.proposal }] : [],
  );
}

export interface AdoptedFocusUpdate {
  directionId: string;
  focusBrief: string;
  /** 同方向被连带作废的其余 pending 提案条数，供管理页提示 */
  supersededCount: number;
}

/**
 * 采纳提案：提案全文覆盖方向的 focusBrief，把该期标记为 adopted，并把同方向其余
 * pending 提案一并置 dismissed。
 *
 * 连带作废不是省事，是语义要求：提案是「修订后的全文」而不是 diff，每条都基于
 * 生成当期时的 focusBrief 写成。同方向可以同时挂着第 10、11 期两条 pending，列表
 * 按 createdAt desc，管理员从上往下点（先 11 后 10）的话，后采纳的旧提案会把新的
 * 演化整段覆盖回去，且没有任何入口能发现。采纳一条即意味着其余基于旧 brief 的
 * 重写全部作废——提案正文永久留在各自 digests 行里，只是状态变 dismissed，随时可读。
 *
 * D1 无事务，写序是 directions → 本期 adopted → 清理其余 pending：
 * - 先覆盖 focusBrief 再改 status：中断的最坏情形是「已覆盖但仍 pending」，管理员
 *   再点一次采纳会写入同一段文本，幂等无害；反过来（先改 status）崩在中间就永久
 *   丢掉这次演化，而且再也没有入口能找回。
 * - 清理放最后：中断只是漏清理，那些提案仍是 pending，再采纳一次即可，无害。
 *
 * 返回 null = 这条提案不在 pending（已被采纳/驳回，或压根没有提案），由 router
 * 翻成 BAD_REQUEST；重复点击不会二次覆盖 focusBrief。
 */
export async function adoptFocusUpdateStore(
  db: Db,
  digestId: string,
): Promise<AdoptedFocusUpdate | null> {
  const [row] = await db
    .select({
      directionId: digests.directionId,
      proposal: digests.proposedFocusUpdate,
      status: digests.proposedFocusUpdateStatus,
    })
    .from(digests)
    .where(eq(digests.id, digestId))
    .limit(1);
  if (!row || row.status !== "pending" || !row.proposal) return null;
  await db
    .update(directions)
    .set({ focusBrief: row.proposal, updatedAt: new Date() })
    .where(eq(directions.id, row.directionId));
  await db
    .update(digests)
    .set({ proposedFocusUpdateStatus: "adopted", updatedAt: new Date() })
    .where(eq(digests.id, digestId));

  // 谓词只写一次，计数与清理共用：各抄一遍的话，只改其中一处（例如清理侧漏掉
  // pending 守卫）就会给该方向的**全部历史期**盖上 dismissed、连既有的 adopted
  // 记录一起擦掉，而计数侧照旧正确、测试全绿。共用常量让这种分叉无从发生。
  const siblingPending = and(
    eq(digests.directionId, row.directionId),
    eq(digests.proposedFocusUpdateStatus, "pending"),
    ne(digests.id, digestId),
  );
  // 先数再写而不是读 UPDATE 的 changes：D1Result.meta 的形状不是所有执行路径都
  // 给得出（测试用的 node:sqlite 适配层就只回 node 的 RunResult），条数要能确定。
  // 谓词是三个定值（不是 inArray 大数组），不受 D1 单查询 100 绑定参数上限影响。
  const [supersededRow] = await db
    .select({ value: count() })
    .from(digests)
    .where(siblingPending);
  const supersededCount = supersededRow?.value ?? 0;
  if (supersededCount > 0) {
    await db
      .update(digests)
      .set({ proposedFocusUpdateStatus: "dismissed", updatedAt: new Date() })
      .where(siblingPending);
  }
  return {
    directionId: row.directionId,
    focusBrief: row.proposal,
    supersededCount,
  };
}

/** 驳回提案：只改 status，focusBrief 一个字不动 */
export async function dismissFocusUpdateStore(
  db: Db,
  digestId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ status: digests.proposedFocusUpdateStatus })
    .from(digests)
    .where(eq(digests.id, digestId))
    .limit(1);
  if (!row || row.status !== "pending") return false;
  await db
    .update(digests)
    .set({ proposedFocusUpdateStatus: "dismissed", updatedAt: new Date() })
    .where(eq(digests.id, digestId));
  return true;
}

/** intro 单独写：upsertDirection 是整体覆盖式的，不能拿来只改一个字段 */
export async function setDirectionIntro(
  db: Db,
  directionId: string,
  intro: Record<string, string>,
): Promise<void> {
  await db
    .update(directions)
    .set({ intro, updatedAt: new Date() })
    .where(eq(directions.id, directionId));
}

export interface AdminFeedbackRow {
  paperTitle: string;
  paperShortId: string;
  /** 列表 key 用它而不是 userName：同名 GitHub 用户会撞 key */
  userId: string;
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
      userId: paperFeedback.userId,
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
