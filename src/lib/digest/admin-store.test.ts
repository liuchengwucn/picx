/**
 * 管理面数据层跑在真 SQLite 上（见 test/helpers/sqlite-d1）：要验的是删除防呆的
 * COUNT、slug 唯一冲突、每方向 limit 10 的窗口，以及「内部字段确实暴露给管理面」
 * ——这些都只有让 SQL 真跑一遍才看得见。
 */
import { eq } from "drizzle-orm";
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
  deleteDirectionGuarded,
  listDirectionsAdmin,
  listRecentDigestsAdmin,
  listRecentFeedbackAdmin,
  reviveSource,
  upsertDirection,
  upsertSource,
} from "./admin-store";

type Db = ReturnType<typeof createTestDb>["db"];

const PERIOD_START = new Date("2026-07-27T00:00:00Z");
const PERIOD_END = new Date("2026-08-03T00:00:00Z");

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

  // dir-withdigests: 12 期，第 12 期 failed（管理面必须看得见非 published 的期）
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
      proposedFocusUpdateStatus: i === 10 ? ("pending" as const) : null,
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
