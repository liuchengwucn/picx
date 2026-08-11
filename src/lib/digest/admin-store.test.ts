/**
 * 管理面数据层跑在真 SQLite 上（见 test/helpers/sqlite-d1）：要验的是删除防呆的
 * COUNT、slug 唯一冲突、每方向 limit 10 的窗口，以及「内部字段确实暴露给管理面」
 * ——这些都只有让 SQL 真跑一遍才看得见。
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
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
  listRecentDigestsAdmin,
  listRecentFeedbackAdmin,
  reviveSource,
  upsertDirection,
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
      name: four("Brand New"),
      focusBrief: "刚建的方向",
      isActive: true,
      sortOrder: 2,
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

describe("deleteDirectionGuarded", () => {
  it("deletes a direction with no digests and no papers, taking its sources with it", async () => {
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

  it("refuses to delete a direction that has digests", async () => {
    await expect(
      deleteDirectionGuarded(db, "dir-withdigests"),
    ).resolves.toEqual({ deleted: false });
    const dirs = await db
      .select()
      .from(directions)
      .where(eq(directions.id, "dir-withdigests"));
    expect(dirs).toHaveLength(1);
  });

  it("refuses to delete a direction that still has papers attached", async () => {
    await expect(deleteDirectionGuarded(db, "dir-withpapers")).resolves.toEqual(
      { deleted: false },
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
