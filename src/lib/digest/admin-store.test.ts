/**
 * 管理面数据层跑在真 SQLite 上（见 test/helpers/sqlite-d1）：要验的是删除防呆的
 * COUNT、slug 唯一冲突、每方向 limit 10 的窗口，以及「内部字段确实暴露给管理面」
 * ——这些都只有让 SQL 真跑一遍才看得见。
 */
import { eq, getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  digests,
  directionSources,
  directions,
  paperFeedback,
  papers,
  user,
} from "#/db/schema";
import { createTestDb } from "../../../test/helpers/sqlite-d1";
import {
  adoptFocusUpdateStore,
  deleteDirectionGuarded,
  dismissFocusUpdateStore,
  listDirectionsAdmin,
  listPendingProposals,
  listRecentDigestsAdmin,
  listRecentFeedbackAdmin,
  reviveSource,
  setDirectionIntro,
  upsertDirection,
  upsertSource,
} from "./admin-store";
import { saveDigestContent } from "./store";

type Db = ReturnType<typeof createTestDb>["db"];

const PERIOD_START = new Date("2026-07-27T00:00:00Z");
const PERIOD_END = new Date("2026-08-03T00:00:00Z");
/** dg-11 上待审的 focusBrief 更新提案（提案是「修订后的全文」，不是 diff） */
const PROPOSAL = "自动定理证明；本周起把形式化验证的工程落地也纳入重点";

function four(prefix: string): Record<string, string> {
  return {
    en: `${prefix} en`,
    "zh-cn": `${prefix} zh-cn`,
    "zh-tw": `${prefix} zh-tw`,
    ja: `${prefix} ja`,
  };
}

/**
 * dir-withDigests 有历史期，dir-withPapers 有论文，dir-clean 只有源。
 * 每个用例一个全新库：本文件全是写操作。
 */
async function seed(db: Db) {
  const now = new Date();
  await db.insert(user).values([
    {
      id: "u1",
      name: "Alice",
      email: "u1@example.com",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "u2",
      name: "Bob",
      email: "u2@example.com",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(directions).values([
    {
      id: "dir-withdigests",
      slug: "ai4formath",
      name: four("AI4Math"),
      focusBrief: "自动定理证明",
      isActive: true,
      sortOrder: 0,
    },
    {
      id: "dir-withpapers",
      slug: "agents",
      name: four("Agents"),
      focusBrief: "智能体",
      isActive: true,
      sortOrder: 1,
    },
    {
      id: "dir-clean",
      slug: "brandnew",
      // 与 dir-withpapers 同序号：listDirectionsAdmin 的次级排序键 asc(slug)
      // 只有在 sortOrder 打平时才起作用，三个各不相同的话去掉它测试照样绿
      sortOrder: 1,
      name: four("Brand New"),
      focusBrief: "刚建的方向",
      isActive: true,
    },
  ]);

  await db.insert(directionSources).values([
    {
      id: "dsrc-clean-1",
      directionId: "dir-clean",
      adapterType: "arxiv_query",
      config: { query: "cat:cs.AI", maxResults: 30 },
      enabled: true,
    },
    {
      id: "dsrc-clean-2",
      directionId: "dir-clean",
      adapterType: "rss",
      config: { url: "https://example.com/feed.xml" },
      enabled: true,
    },
    {
      id: "dsrc-other",
      directionId: "dir-withpapers",
      adapterType: "rss",
      config: { url: "https://example.com/other.xml" },
      enabled: true,
    },
  ]);

  // dir-withdigests: 12 期，第 12 期 failed（管理面必须看得见非 published 的期）；
  // 第 11 期带一条待审的 focusBrief 提案
  await db.insert(digests).values(
    Array.from({ length: 12 }, (_, i) => ({
      id: `dg-${i + 1}`,
      directionId: "dir-withdigests",
      issueNumber: i + 1,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      status: (i === 11 ? "failed" : "published") as "failed" | "published",
      title: four(`Issue ${i + 1}`),
      workflowInstanceId: `wf-${i + 1}`,
      publishedAt: i === 11 ? null : new Date("2026-08-03T01:00:00Z"),
      proposedFocusUpdate: i === 10 ? PROPOSAL : null,
      proposedFocusUpdateStatus: i === 10 ? ("pending" as const) : null,
      // 显式错开：listPendingProposals 按 createdAt desc 排序，默认值同毫秒排不出来
      createdAt: new Date(PERIOD_END.getTime() + (i + 1) * 60_000),
    })),
  );

  await db.insert(papers).values({
    id: "p1",
    shortId: "sid1",
    userId: "u1",
    title: "Paper One",
    sourceType: "arxiv",
    pdfR2Key: "papers/p1.pdf",
    fileSize: 1,
    status: "completed",
    isPublic: true,
    isListedInGallery: true,
    directionId: "dir-withpapers",
  });
}

let db: Db;

beforeEach(async () => {
  db = createTestDb().db;
  await seed(db);
});

/** 物理删除的前置条件是先停用 */
async function deactivate(db: Db, id: string) {
  await db
    .update(directions)
    .set({ isActive: false })
    .where(eq(directions.id, id));
}

describe("deleteDirectionGuarded", () => {
  it("deletes a deactivated direction with no digests and no papers, cascading its sources", async () => {
    await deactivate(db, "dir-clean");
    await expect(deleteDirectionGuarded(db, "dir-clean")).resolves.toEqual({
      deleted: true,
    });
    const dirs = await db
      .select()
      .from(directions)
      .where(eq(directions.id, "dir-clean"));
    expect(dirs).toHaveLength(0);
    const srcs = await db
      .select()
      .from(directionSources)
      .where(eq(directionSources.directionId, "dir-clean"));
    expect(srcs).toHaveLength(0);
    // 只删自己名下的源
    const others = await db.select().from(directionSources);
    expect(others.map((s) => s.id)).toEqual(["dsrc-other"]);
  });

  // 两次 COUNT 与 DELETE 之间，在飞的 workflow 可能刚插入 digest 行；
  // 只删已停用方向（cron 不再为其排期）才关得上这个窗口
  it("refuses to delete a direction that is still active", async () => {
    await expect(deleteDirectionGuarded(db, "dir-clean")).resolves.toEqual({
      deleted: false,
      reason: "still_active",
    });
    const dirs = await db
      .select()
      .from(directions)
      .where(eq(directions.id, "dir-clean"));
    expect(dirs).toHaveLength(1);
  });

  it("reports not_found for an unknown direction instead of claiming success", async () => {
    await expect(deleteDirectionGuarded(db, "dir-nope")).resolves.toEqual({
      deleted: false,
      reason: "not_found",
    });
  });

  it("refuses to delete a direction that has digests", async () => {
    await deactivate(db, "dir-withdigests");
    await expect(
      deleteDirectionGuarded(db, "dir-withdigests"),
    ).resolves.toEqual({ deleted: false, reason: "has_history" });
    const dirs = await db
      .select()
      .from(directions)
      .where(eq(directions.id, "dir-withdigests"));
    expect(dirs).toHaveLength(1);
  });

  // has_history 优先于 still_active：反过来的话管理员会先被引去停用（=该方向所有
  // 历史期立刻 404、主页 tab 消失），停完再点删才发现根本删不掉
  it("reports has_history before still_active, so nobody deactivates a direction that can never be deleted", async () => {
    const [before] = await db
      .select({ isActive: directions.isActive })
      .from(directions)
      .where(eq(directions.id, "dir-withdigests"));
    expect(before.isActive).toBe(true);
    await expect(
      deleteDirectionGuarded(db, "dir-withdigests"),
    ).resolves.toEqual({ deleted: false, reason: "has_history" });
  });

  it("refuses to delete a direction that still has papers attached", async () => {
    await deactivate(db, "dir-withpapers");
    await expect(deleteDirectionGuarded(db, "dir-withpapers")).resolves.toEqual(
      { deleted: false, reason: "has_history" },
    );
    const dirs = await db
      .select()
      .from(directions)
      .where(eq(directions.id, "dir-withpapers"));
    expect(dirs).toHaveLength(1);
    // 源也不能被顺手删掉
    const srcs = await db
      .select()
      .from(directionSources)
      .where(eq(directionSources.directionId, "dir-withpapers"));
    expect(srcs).toHaveLength(1);
  });
});

describe("upsertDirection", () => {
  it("creates a direction with a readable dir-{slug} id", async () => {
    const result = await upsertDirection(db, {
      slug: "robotics",
      name: four("Robotics"),
      focusBrief: "具身智能",
      isActive: true,
      sortOrder: 5,
    });
    expect(result).toEqual({ id: "dir-robotics" });
    const [row] = await db
      .select()
      .from(directions)
      .where(eq(directions.slug, "robotics"));
    expect(row).toMatchObject({
      id: "dir-robotics",
      focusBrief: "具身智能",
      intro: null,
      isActive: true,
      sortOrder: 5,
    });
  });

  it("rejects a new direction whose slug is taken, inserting nothing", async () => {
    const before = await db.select().from(directions);
    const result = await upsertDirection(db, {
      slug: "ai4formath",
      name: four("Clash"),
      focusBrief: "撞车",
      isActive: true,
      sortOrder: 9,
    });
    expect(result).toEqual({ error: "slug_taken" });
    const after = await db.select().from(directions);
    expect(after).toHaveLength(before.length);
    expect(after.map((d) => d.focusBrief)).not.toContain("撞车");
  });

  it("updates an existing direction keeping its own slug", async () => {
    const result = await upsertDirection(db, {
      id: "dir-withdigests",
      slug: "ai4formath",
      name: four("AI4Math v2"),
      focusBrief: "改过的口味描述",
      intro: four("公开简介"),
      isActive: false,
      sortOrder: 7,
    });
    expect(result).toEqual({ id: "dir-withdigests" });
    const [row] = await db
      .select()
      .from(directions)
      .where(eq(directions.id, "dir-withdigests"));
    expect(row).toMatchObject({
      slug: "ai4formath",
      focusBrief: "改过的口味描述",
      isActive: false,
      sortOrder: 7,
    });
    expect(row.name.en).toBe("AI4Math v2 en");
    expect(row.intro?.ja).toBe("公开简介 ja");
  });

  // id 不随 slug 改名而变，所以 dir-{slug} 可能早被一个改过名的方向占着：
  // 撞了主键就退随机后缀，否则 insert 抛的裸 SQL 错会把 focusBrief 全文回传前端，
  // 而且这个 slug 从此再也建不出来
  it("falls back to a suffixed id when dir-{slug} is already taken by a renamed direction", async () => {
    const first = await upsertDirection(db, {
      slug: "alpha",
      name: four("Alpha"),
      focusBrief: "第一个",
      isActive: true,
      sortOrder: 5,
    });
    expect(first).toEqual({ id: "dir-alpha" });
    // 改名腾出 slug alpha，但 id 仍是 dir-alpha
    await upsertDirection(db, {
      id: "dir-alpha",
      slug: "beta",
      name: four("Beta"),
      focusBrief: "改名了",
      isActive: true,
      sortOrder: 5,
    });

    const second = await upsertDirection(db, {
      slug: "alpha",
      name: four("Alpha again"),
      focusBrief: "重新占用 alpha",
      isActive: true,
      sortOrder: 6,
    });
    expect(second).not.toHaveProperty("error");
    const id = (second as { id: string }).id;
    expect(id).toMatch(/^dir-alpha-[0-9a-f]{8}$/);
    const [row] = await db
      .select()
      .from(directions)
      .where(eq(directions.slug, "alpha"));
    expect(row.id).toBe(id);
    expect(row.focusBrief).toBe("重新占用 alpha");
  });

  // drizzle 的 DrizzleQueryError.message 里拼着全部绑定参数（含 focusBrief 全文），
  // 拿它匹配 "UNIQUE constraint failed" 等于让管理员输入决定错误分类：一次无关的
  // 写入失败会被报成 slug_taken，真错误还连日志都不打，排查两头落空
  it("does not mistake an unrelated write failure for slug_taken when focusBrief mentions the constraint text", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        upsertDirection(db, {
          slug: "poisoned",
          // name 是 NOT NULL 的 json 列，undefined 会被 drizzle 略过 → NOT NULL 违约
          name: undefined as unknown as Record<string, string>,
          focusBrief: "关注数据库：UNIQUE constraint failed 这类错误的处理",
          isActive: true,
          sortOrder: 3,
        }),
      ).rejects.toThrow("failed to persist direction");
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it("reports not_found when updating a direction that no longer exists", async () => {
    await expect(
      upsertDirection(db, {
        id: "dir-gone",
        slug: "ghost",
        name: four("Ghost"),
        focusBrief: "另一个标签页已经把它删了",
        isActive: true,
        sortOrder: 0,
      }),
    ).resolves.toEqual({ error: "not_found" });
    const rows = await db
      .select()
      .from(directions)
      .where(eq(directions.slug, "ghost"));
    expect(rows).toHaveLength(0);
  });

  it("rejects an update that steals another direction's slug, leaving the row untouched", async () => {
    const result = await upsertDirection(db, {
      id: "dir-withdigests",
      slug: "agents",
      name: four("Stolen"),
      focusBrief: "不该被写进去",
      isActive: false,
      sortOrder: 99,
    });
    expect(result).toEqual({ error: "slug_taken" });
    const [row] = await db
      .select()
      .from(directions)
      .where(eq(directions.id, "dir-withdigests"));
    expect(row).toMatchObject({
      slug: "ai4formath",
      focusBrief: "自动定理证明",
      isActive: true,
      sortOrder: 0,
    });
  });
});

describe("listDirectionsAdmin", () => {
  it("orders by sortOrder then slug and groups each direction's sources under it", async () => {
    const rows = await listDirectionsAdmin(db);
    expect(rows.map((d) => d.slug)).toEqual([
      "ai4formath",
      "agents",
      "brandnew",
    ]);
    expect(rows.map((d) => d.sources.length)).toEqual([0, 1, 2]);
    expect(rows[2].sources.map((s) => s.id)).toEqual([
      "dsrc-clean-1",
      "dsrc-clean-2",
    ]);
    expect(rows[2].sources[0]).toMatchObject({
      adapterType: "arxiv_query",
      config: { query: "cat:cs.AI", maxResults: 30 },
      enabled: true,
    });
    expect(rows[1].sources[0].id).toBe("dsrc-other");
  });

  it("exposes the internal fields the public queries deliberately hide", async () => {
    await db
      .update(directionSources)
      .set({
        enabled: false,
        consecutiveFailures: 4,
        lastError: "429 Too Many Requests",
        lastAttemptAt: new Date("2026-08-09T00:00:00Z"),
      })
      .where(eq(directionSources.id, "dsrc-clean-1"));

    const rows = await listDirectionsAdmin(db);
    const clean = rows.find((d) => d.slug === "brandnew");
    expect(clean?.sources[0]).toMatchObject({
      enabled: false,
      consecutiveFailures: 4,
      lastError: "429 Too Many Requests",
      lastAttemptAt: new Date("2026-08-09T00:00:00Z"),
      lastFetchedAt: null,
    });
    // focusBrief 是喂 LLM 的内部口味描述，管理页要能读到并编辑
    expect(clean?.focusBrief).toBe("刚建的方向");
  });
});

describe("upsertSource", () => {
  it("creates a source with a dsrc- prefixed id under the given direction", async () => {
    const result = await upsertSource(db, {
      directionId: "dir-clean",
      adapterType: "rss",
      config: { url: "https://example.com/new.xml" },
      enabled: true,
    });
    expect(result).not.toHaveProperty("error");
    const id = (result as { id: string }).id;
    expect(id).toMatch(/^dsrc-[0-9a-f]{8}$/);
    const [row] = await db
      .select()
      .from(directionSources)
      .where(eq(directionSources.id, id));
    expect(row).toMatchObject({
      directionId: "dir-clean",
      adapterType: "rss",
      enabled: true,
    });
  });

  it("updates config and enabled only, ignoring a directionId move", async () => {
    const result = await upsertSource(db, {
      id: "dsrc-clean-1",
      directionId: "dir-withpapers", // 刻意搬家：源不能换方向，这里应被忽略
      adapterType: "rss",
      config: { url: "https://example.com/changed.xml" },
      enabled: false,
    });
    expect(result).toEqual({ id: "dsrc-clean-1" });
    const [row] = await db
      .select()
      .from(directionSources)
      .where(eq(directionSources.id, "dsrc-clean-1"));
    expect(row).toMatchObject({
      directionId: "dir-clean",
      adapterType: "rss",
      config: { url: "https://example.com/changed.xml" },
      enabled: false,
    });
  });

  // 不查存在性的话，INSERT 撞外键抛出的裸 SQL（含全部绑定参数）会被 tRPC
  // 当成 INTERNAL_SERVER_ERROR 原样回传前端
  it("reports not_found when creating a source under a direction that no longer exists", async () => {
    const before = await db.select().from(directionSources);
    await expect(
      upsertSource(db, {
        directionId: "dir-does-not-exist",
        adapterType: "rss",
        config: { url: "https://example.com/x.xml" },
        enabled: true,
      }),
    ).resolves.toEqual({ error: "not_found" });
    const after = await db.select().from(directionSources);
    expect(after).toHaveLength(before.length);
  });

  it("reports not_found when updating a source that no longer exists", async () => {
    const before = await db.select().from(directionSources);
    await expect(
      upsertSource(db, {
        id: "dsrc-gone",
        directionId: "dir-clean",
        adapterType: "rss",
        config: { url: "https://example.com/ghost.xml" },
        enabled: true,
      }),
    ).resolves.toEqual({ error: "not_found" });
    const after = await db.select().from(directionSources);
    expect(after).toHaveLength(before.length);
  });
});

describe("reviveSource", () => {
  it("re-enables a tripped source and clears its failure state", async () => {
    await db
      .update(directionSources)
      .set({ enabled: false, consecutiveFailures: 10, lastError: "boom" })
      .where(eq(directionSources.id, "dsrc-clean-1"));

    await reviveSource(db, "dsrc-clean-1");

    const [row] = await db
      .select()
      .from(directionSources)
      .where(eq(directionSources.id, "dsrc-clean-1"));
    expect(row).toMatchObject({
      enabled: true,
      consecutiveFailures: 0,
      lastError: null,
    });
  });
});

describe("listRecentDigestsAdmin", () => {
  it("returns the 10 newest issues per direction including internal fields", async () => {
    const rows = await listRecentDigestsAdmin(db);
    const forDirection = rows.filter((r) => r.directionSlug === "ai4formath");
    expect(forDirection.map((r) => r.issueNumber)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ]);
    // 非 published 的期与内部字段都要暴露给管理面（与公开查询刻意相反）
    expect(forDirection[0]).toMatchObject({
      digestId: "dg-12",
      directionId: "dir-withdigests",
      status: "failed",
      workflowInstanceId: "wf-12",
      publishedAt: null,
    });
    expect(forDirection[1].proposedFocusUpdateStatus).toBe("pending");
    // 无期数的方向不产生行
    expect(rows.map((r) => r.directionSlug)).not.toContain("brandnew");
  });
});

/** 读方向当前的 focusBrief / intro */
async function readDirection(db: Db, id: string) {
  const [row] = await db
    .select({ focusBrief: directions.focusBrief, intro: directions.intro })
    .from(directions)
    .where(eq(directions.id, id));
  return row;
}

async function readProposal(db: Db, digestId: string) {
  const [row] = await db
    .select({
      proposedFocusUpdate: digests.proposedFocusUpdate,
      proposedFocusUpdateStatus: digests.proposedFocusUpdateStatus,
    })
    .from(digests)
    .where(eq(digests.id, digestId));
  return row;
}

// 提案的入队点：workflow 定稿 step 调 saveDigestContent 落提案，状态机的
// pending 就是在这里产生的（没有别的入口）
describe("saveDigestContent proposal status", () => {
  it("queues a non-empty proposal for review", async () => {
    await saveDigestContent(db, "dg-1", {
      proposedFocusUpdate: "改一改口味描述",
    });
    expect(await readProposal(db, "dg-1")).toEqual({
      proposedFocusUpdate: "改一改口味描述",
      proposedFocusUpdateStatus: "pending",
    });
  });

  it("leaves the status NULL when there is no proposal", async () => {
    await saveDigestContent(db, "dg-1", {
      title: four("Issue 1 v2"),
      proposedFocusUpdate: null,
    });
    expect(
      (await readProposal(db, "dg-1")).proposedFocusUpdateStatus,
    ).toBeNull();
  });

  // SynthesisResult 是裸 JSON.parse，没有 zod 兜底：模型偶发返回 "" / 纯空白，
  // 那不该在管理页变成一条点开是空的审阅项（与 0030 迁移的 trim 回填条件一致）
  it("does not queue a whitespace-only proposal", async () => {
    await saveDigestContent(db, "dg-1", { proposedFocusUpdate: "   " });
    expect(
      (await readProposal(db, "dg-1")).proposedFocusUpdateStatus,
    ).toBeNull();
  });

  // 定稿之后还会有 publish 等后续 patch，它们不带 proposedFocusUpdate，
  // 不能把已入队的提案顺手打回 NULL
  it("keeps an already queued proposal when a later patch omits the field", async () => {
    await saveDigestContent(db, "dg-11", {
      status: "published",
      publishedAt: new Date("2026-08-04T00:00:00Z"),
    });
    expect(await readProposal(db, "dg-11")).toEqual({
      proposedFocusUpdate: PROPOSAL,
      proposedFocusUpdateStatus: "pending",
    });
  });
});

describe("adoptFocusUpdateStore", () => {
  it("overwrites focusBrief with the full proposal and marks the issue adopted", async () => {
    await expect(adoptFocusUpdateStore(db, "dg-11")).resolves.toEqual({
      directionId: "dir-withdigests",
      focusBrief: PROPOSAL,
    });
    expect((await readDirection(db, "dir-withdigests")).focusBrief).toBe(
      PROPOSAL,
    );
    expect((await readProposal(db, "dg-11")).proposedFocusUpdateStatus).toBe(
      "adopted",
    );
  });

  // D1 无事务：先写 focusBrief 再改 status，中断的最坏情形是「已覆盖但仍 pending」，
  // 重复采纳写入同一文本、幂等无害；反过来崩在中间就永久丢掉这次演化
  it("writes focusBrief before flipping the status", async () => {
    const update = vi.spyOn(db, "update");
    await adoptFocusUpdateStore(db, "dg-11");
    expect(update.mock.calls.map((c) => getTableName(c[0] as never))).toEqual([
      "directions",
      "digests",
    ]);
    update.mockRestore();
  });

  it("refuses a second adoption instead of overwriting an edited focusBrief", async () => {
    await adoptFocusUpdateStore(db, "dg-11");
    // 管理员采纳后又手工改了一版
    await db
      .update(directions)
      .set({ focusBrief: "人工又改过一次" })
      .where(eq(directions.id, "dir-withdigests"));

    await expect(adoptFocusUpdateStore(db, "dg-11")).resolves.toBeNull();
    expect((await readDirection(db, "dir-withdigests")).focusBrief).toBe(
      "人工又改过一次",
    );
  });

  it("returns null for an issue that never produced a proposal", async () => {
    await expect(adoptFocusUpdateStore(db, "dg-1")).resolves.toBeNull();
    expect((await readDirection(db, "dir-withdigests")).focusBrief).toBe(
      "自动定理证明",
    );
  });

  it("returns null for an unknown digest id", async () => {
    await expect(adoptFocusUpdateStore(db, "dg-nope")).resolves.toBeNull();
  });
});

describe("dismissFocusUpdateStore", () => {
  it("marks the issue dismissed without touching focusBrief", async () => {
    await expect(dismissFocusUpdateStore(db, "dg-11")).resolves.toBe(true);
    expect((await readProposal(db, "dg-11")).proposedFocusUpdateStatus).toBe(
      "dismissed",
    );
    expect((await readDirection(db, "dir-withdigests")).focusBrief).toBe(
      "自动定理证明",
    );
  });

  it("refuses to dismiss an already adopted proposal", async () => {
    await adoptFocusUpdateStore(db, "dg-11");
    await expect(dismissFocusUpdateStore(db, "dg-11")).resolves.toBe(false);
    expect((await readProposal(db, "dg-11")).proposedFocusUpdateStatus).toBe(
      "adopted",
    );
  });

  it("refuses to dismiss twice", async () => {
    await dismissFocusUpdateStore(db, "dg-11");
    await expect(dismissFocusUpdateStore(db, "dg-11")).resolves.toBe(false);
  });
});

describe("listPendingProposals", () => {
  /** 给 dir-withpapers 造几期各种审阅状态的对照 */
  async function seedOtherStatuses(db: Db) {
    await db.insert(digests).values([
      {
        id: "dg-adopted",
        directionId: "dir-withpapers",
        issueNumber: 1,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        status: "published" as const,
        workflowInstanceId: "wf-adopted",
        proposedFocusUpdate: "已采纳的提案",
        proposedFocusUpdateStatus: "adopted" as const,
        createdAt: new Date("2026-08-05T00:00:00Z"),
      },
      {
        id: "dg-dismissed",
        directionId: "dir-withpapers",
        issueNumber: 2,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        status: "published" as const,
        workflowInstanceId: "wf-dismissed",
        proposedFocusUpdate: "已驳回的提案",
        proposedFocusUpdateStatus: "dismissed" as const,
        createdAt: new Date("2026-08-06T00:00:00Z"),
      },
      {
        id: "dg-noproposal",
        directionId: "dir-withpapers",
        issueNumber: 3,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        status: "published" as const,
        workflowInstanceId: "wf-noproposal",
        createdAt: new Date("2026-08-07T00:00:00Z"),
      },
    ]);
  }

  it("returns only pending proposals, newest first, with the direction's current focusBrief", async () => {
    await seedOtherStatuses(db);
    // 另一个方向也有一条待审，且比 dg-11 新
    await db.insert(digests).values({
      id: "dg-pending-2",
      directionId: "dir-withpapers",
      issueNumber: 4,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      status: "published" as const,
      workflowInstanceId: "wf-pending-2",
      proposedFocusUpdate: "智能体：补上评测基准",
      proposedFocusUpdateStatus: "pending" as const,
      createdAt: new Date("2026-08-09T00:00:00Z"),
    });

    const rows = await listPendingProposals(db);
    expect(rows.map((r) => r.digestId)).toEqual(["dg-pending-2", "dg-11"]);
    expect(rows[1]).toMatchObject({
      issueNumber: 11,
      proposal: PROPOSAL,
      directionId: "dir-withdigests",
      directionSlug: "ai4formath",
      // currentFocusBrief 是方向当前的值，不是提案值——管理页要拿这两者上下对照
      currentFocusBrief: "自动定理证明",
    });
    expect(rows[1].directionName.ja).toBe("AI4Math ja");
  });

  it("drops out of the queue once the proposal is acted on", async () => {
    await dismissFocusUpdateStore(db, "dg-11");
    await expect(listPendingProposals(db)).resolves.toEqual([]);
  });

  // 只可能来自 0030 之前的存量数据：saveDigestContent 不会给空提案置 pending
  it("skips a pending row whose proposal text is empty", async () => {
    await db
      .update(digests)
      .set({ proposedFocusUpdate: "" })
      .where(eq(digests.id, "dg-11"));
    await expect(listPendingProposals(db)).resolves.toEqual([]);
  });
});

describe("setDirectionIntro", () => {
  it("writes the four-locale intro without touching focusBrief", async () => {
    await setDirectionIntro(db, "dir-clean", four("公开简介"));
    const row = await readDirection(db, "dir-clean");
    expect(row.intro).toEqual(four("公开简介"));
    expect(row.focusBrief).toBe("刚建的方向");
  });
});

describe("listRecentFeedbackAdmin", () => {
  it("joins paper and user onto each feedback row, newest first", async () => {
    await db.insert(paperFeedback).values([
      {
        id: "fb-1",
        paperId: "p1",
        userId: "u1",
        vote: 1,
        updatedAt: new Date("2026-08-01T00:00:00Z"),
      },
      {
        id: "fb-2",
        paperId: "p1",
        userId: "u2",
        vote: -1,
        reasonPreset: "off-topic",
        reasonText: "跑题了",
        updatedAt: new Date("2026-08-02T00:00:00Z"),
      },
    ]);

    const rows = await listRecentFeedbackAdmin(db);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      paperTitle: "Paper One",
      paperShortId: "sid1",
      userName: "Bob",
      vote: -1,
      reasonPreset: "off-topic",
      reasonText: "跑题了",
      updatedAt: new Date("2026-08-02T00:00:00Z"),
    });
    expect(rows[1]).toMatchObject({
      userName: "Alice",
      vote: 1,
      reasonPreset: null,
      reasonText: null,
    });
  });
});
