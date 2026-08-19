// 合刊聚合查询：分组、缺席、去重、软删、邻期。用真 SQLite 回放迁移，
// 因为这些语义全在 WHERE / GROUP BY / date() 里，mock 链看不见。
import { beforeAll, describe, expect, it } from "vitest";
import {
  digestPapers,
  digests,
  directions,
  papers,
  user,
  whiteboardImages,
} from "#/db/schema";
import { createTestDb } from "../../../test/helpers/sqlite-d1";
import {
  getEditionByPeriod,
  listEditionPeriods,
  PICKS_PER_SECTION,
} from "./store";

type Db = ReturnType<typeof createTestDb>["db"];

// 两组：老一期 08-08 / 新一期 08-15。period_end 刻意用 23:59:59，
// 与线上真实值同形（按时间戳分组的实现会在这里露出问题）。
const OLD_END = new Date("2026-08-08T23:59:59Z");
const NEW_END = new Date("2026-08-15T23:59:59Z");
const OLD_START = new Date("2026-08-01T23:59:59Z");
const NEW_START = new Date("2026-08-08T23:59:59Z");

function four(prefix: string): Record<string, string> {
  return {
    en: `${prefix} en`,
    "zh-cn": `${prefix} zh-cn`,
    "zh-tw": `${prefix} zh-tw`,
    ja: `${prefix} ja`,
  };
}

async function seed(db: Db) {
  const now = new Date();
  await db.insert(user).values({
    id: "u1",
    name: "u1",
    email: "u1@example.com",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(directions).values([
    // sortOrder 决定栏目顺序；createdAt 决定方向色的先到先得
    {
      id: "dir-a",
      slug: "aaa",
      name: four("A"),
      focusBrief: "a",
      isActive: true,
      sortOrder: 0,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: now,
    },
    {
      id: "dir-b",
      slug: "bbb",
      name: four("B"),
      focusBrief: "b",
      isActive: true,
      sortOrder: 1,
      createdAt: new Date("2026-02-01T00:00:00Z"),
      updatedAt: now,
    },
    // 本期缺席：算进 activeDirectionCount，但不出栏目
    {
      id: "dir-c",
      slug: "ccc",
      name: four("C"),
      focusBrief: "c",
      isActive: true,
      sortOrder: 2,
      createdAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: now,
    },
    // 已下线：既不出栏目也不算进总数
    {
      id: "dir-x",
      slug: "xxx",
      name: four("X"),
      focusBrief: "x",
      isActive: false,
      sortOrder: 3,
      createdAt: new Date("2026-04-01T00:00:00Z"),
      updatedAt: now,
    },
  ]);

  await db.insert(digests).values([
    {
      id: "dg-a-new",
      directionId: "dir-a",
      issueNumber: 2,
      periodStart: NEW_START,
      periodEnd: NEW_END,
      status: "published",
      title: four("A2"),
      content: four("A2 body"),
      workflowInstanceId: "wf-a2",
      publishedAt: new Date("2026-08-18T06:00:00Z"),
    },
    // 同一方向同一组的第二期（补跑残留）：只应留期号最大的 dg-a-new
    {
      id: "dg-a-dup",
      directionId: "dir-a",
      issueNumber: 1,
      periodStart: NEW_START,
      periodEnd: NEW_END,
      status: "published",
      title: four("A1"),
      content: four("A1 body"),
      workflowInstanceId: "wf-a1",
      publishedAt: new Date("2026-08-18T05:00:00Z"),
    },
    {
      id: "dg-b-new",
      directionId: "dir-b",
      issueNumber: 1,
      periodStart: NEW_START,
      periodEnd: NEW_END,
      status: "published",
      title: four("B1"),
      content: four("B1 body"),
      workflowInstanceId: "wf-b1",
      publishedAt: new Date("2026-08-18T06:00:00Z"),
    },
    {
      id: "dg-a-old",
      directionId: "dir-a",
      issueNumber: 0,
      periodStart: OLD_START,
      periodEnd: OLD_END,
      status: "published",
      title: four("A0"),
      content: four("A0 body"),
      workflowInstanceId: "wf-a0",
      publishedAt: new Date("2026-08-11T06:00:00Z"),
    },
    // generating 不该出现在任何一组里
    {
      id: "dg-c-gen",
      directionId: "dir-c",
      issueNumber: 1,
      periodStart: NEW_START,
      periodEnd: NEW_END,
      status: "generating",
      workflowInstanceId: "wf-c1",
    },
    // 下线方向的已发布期也不该出现
    {
      id: "dg-x-new",
      directionId: "dir-x",
      issueNumber: 1,
      periodStart: NEW_START,
      periodEnd: NEW_END,
      status: "published",
      title: four("X1"),
      content: four("X1 body"),
      workflowInstanceId: "wf-x1",
      publishedAt: new Date("2026-08-18T06:00:00Z"),
    },
  ]);

  // dir-a 本期 4 篇（1 篇软删 ⇒ pickCount 应为 3），dir-b 本期 1 篇
  await db.insert(papers).values(
    [1, 2, 3, 4, 5].map((i) => ({
      id: `p${i}`,
      userId: "u1",
      shortId: `s${i}`,
      title: `Paper ${i}`,
      sourceType: "arxiv" as const,
      pdfR2Key: `papers/p${i}.pdf`,
      fileSize: 1,
      status: "completed" as const,
      isPublic: true,
      isListedInGallery: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: i === 4 ? now : null,
    })),
  );
  await db.insert(whiteboardImages).values({
    id: "wb1",
    paperId: "p1",
    imageR2Key: "wb/p1.png",
    isDefault: true,
  });
  await db.insert(digestPapers).values([
    {
      digestId: "dg-a-new",
      paperId: "p1",
      rank: 1,
      recommendationNote: four("note1"),
    },
    {
      digestId: "dg-a-new",
      paperId: "p2",
      rank: 2,
      recommendationNote: four("note2"),
    },
    {
      digestId: "dg-a-new",
      paperId: "p3",
      rank: 3,
      recommendationNote: four("note3"),
    },
    {
      digestId: "dg-a-new",
      paperId: "p4",
      rank: 4,
      recommendationNote: four("note4"),
    },
    {
      digestId: "dg-b-new",
      paperId: "p5",
      rank: 1,
      recommendationNote: four("note5"),
    },
  ]);
}

describe("getEditionByPeriod", () => {
  let db: Db;
  beforeAll(async () => {
    db = createTestDb().db;
    await seed(db);
  });

  it("period=null 取最新那组，栏目按 sortOrder 排且不含缺席/下线/generating", async () => {
    const ed = await getEditionByPeriod(db, null);
    expect(ed?.period).toBe("2026-08-15");
    expect(ed?.sections.map((s) => s.directionSlug)).toEqual(["aaa", "bbb"]);
    expect(ed?.activeDirectionCount).toBe(3);
    expect(ed?.isLatest).toBe(true);
    expect(ed?.prevPeriod).toBe("2026-08-08");
    expect(ed?.nextPeriod).toBeNull();
  });

  it("同方向同组多期只留期号最大的那期", async () => {
    const ed = await getEditionByPeriod(db, "2026-08-15");
    const a = ed?.sections.find((s) => s.directionSlug === "aaa");
    expect(a?.issueNumber).toBe(2);
  });

  it("pickCount 不计软删论文，picks 截到 PICKS_PER_SECTION 且按 rank 升序", async () => {
    const ed = await getEditionByPeriod(db, "2026-08-15");
    const a = ed?.sections.find((s) => s.directionSlug === "aaa");
    expect(a?.pickCount).toBe(3);
    expect(a?.picks).toHaveLength(Math.min(3, PICKS_PER_SECTION));
    expect(a?.picks.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(a?.picks[0].whiteboardImageR2Key).toBe("wb/p1.png");
    // 无白板的论文照样在清单里（leftJoin），前端降级成文字条目
    expect(a?.picks[1].whiteboardImageR2Key).toBeNull();
  });

  it("历史那组 isLatest=false 且 nextPeriod 指向新的一组", async () => {
    const ed = await getEditionByPeriod(db, "2026-08-08");
    expect(ed?.isLatest).toBe(false);
    expect(ed?.nextPeriod).toBe("2026-08-15");
    expect(ed?.prevPeriod).toBeNull();
  });

  it("不存在的 period 返回 null", async () => {
    expect(await getEditionByPeriod(db, "2026-01-01")).toBeNull();
  });
});

describe("listEditionPeriods", () => {
  it("按 period 倒序，方向数去重、篇数不含软删", async () => {
    const db = createTestDb().db;
    await seed(db);
    const list = await listEditionPeriods(db);
    expect(list.map((e) => e.period)).toEqual(["2026-08-15", "2026-08-08"]);
    expect(list[0].directionCount).toBe(2);
    expect(list[0].pickCount).toBe(4); // dg-a-new 3 + dg-b-new 1，p4 已软删
    expect(list[0].periodEnd.toISOString()).toBe("2026-08-15T23:59:59.000Z");
  });
});
