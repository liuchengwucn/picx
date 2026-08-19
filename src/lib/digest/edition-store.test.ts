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
} from "./edition-store";

type Db = ReturnType<typeof createTestDb>["db"];

// 三组：老一期 08-08 / 中间一期 08-11（只有 dir-b）/ 新一期 08-15。
// period_end 刻意用 23:59:59，与线上真实值同形（按时间戳分组的实现会在这里
// 露出问题）。中间那组的存在是为了让「prevPeriod 与 nextPeriod 同时非 null」
// 这个生产常态（不是首期也不是最新一期）被断言覆盖到。
const OLD_END = new Date("2026-08-08T23:59:59Z");
const MID_END = new Date("2026-08-11T23:59:59Z");
const NEW_END = new Date("2026-08-15T23:59:59Z");
const OLD_START = new Date("2026-08-01T23:59:59Z");
const MID_START = new Date("2026-08-04T23:59:59Z");
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
    // 故意让期号小的 dg-a-dup 先插入：若实现漏掉 desc(issueNumber) 排序，
    // SQLite 无 ORDER BY 时按插入序返回，「留最大期号」的去重就会悄悄退化成
    // 「留插入序里先出现的」，从而选中 issue=1 而非 issue=2 —— 这条顺序安排
    // 就是让那种回归在测试里变红的关键。
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
    // 同一方向同一组的第二期（补跑残留）：只应留期号最大的 dg-a-new
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
    // 中间那组唯一的一条：只用来证明 prevPeriod/nextPeriod 能同时非 null
    {
      id: "dg-b-mid",
      directionId: "dir-b",
      issueNumber: 0,
      periodStart: MID_START,
      periodEnd: MID_END,
      status: "published",
      title: four("B0"),
      content: four("B0 body"),
      workflowInstanceId: "wf-b0",
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

  // dir-a 本期（获胜的 dg-a-new）5 篇，1 篇软删 ⇒ pickCount 应为 4，仍严格
  // 大于 PICKS_PER_SECTION 以证明 pickCount 是「未软删总数」而非「截断后长
  // 度」；dir-b 本期 1 篇；p7/p8 挂在 dg-a-dup（被取代的补跑残留期）名下，
  // 只用来锁「获胜集合」不变式，不属于任何栏目。
  await db.insert(papers).values(
    [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
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
      digestId: "dg-a-new",
      paperId: "p6",
      rank: 5,
      recommendationNote: four("note6"),
    },
    {
      digestId: "dg-b-new",
      paperId: "p5",
      rank: 1,
      recommendationNote: four("note5"),
    },
    // dg-a-dup 是被 dg-a-new 取代的补跑残留期（同方向同一天，issueNumber 更
    // 小），但它是真实存在的 published digest 且带自己的 picks —— 这才是
    // 补跑残留在生产里的真实形状（不是空 digest）。listEditionPeriods 的
    // pickCount 若不按「获胜」集合过滤，会把这 2 篇也计进去（见下方断言）。
    {
      digestId: "dg-a-dup",
      paperId: "p7",
      rank: 1,
      recommendationNote: four("note7"),
    },
    {
      digestId: "dg-a-dup",
      paperId: "p8",
      rank: 2,
      recommendationNote: four("note8"),
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
    expect(ed?.prevPeriod).toBe("2026-08-11");
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
    // 未软删总数（4）严格大于截断长度（PICKS_PER_SECTION=3）：两种语义在此
    // 不会重合，pickCount 若被误写成 picks.length 这条断言会当场变红。
    expect(a?.pickCount).toBe(4);
    expect(a?.picks.length).toBe(PICKS_PER_SECTION);
    expect(a?.picks.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(a?.picks[0].whiteboardImageR2Key).toBe("wb/p1.png");
    // 无白板的论文照样在清单里（leftJoin），前端降级成文字条目
    expect(a?.picks[1].whiteboardImageR2Key).toBeNull();
  });

  it("历史那组 isLatest=false 且 nextPeriod 指向新的一组", async () => {
    const ed = await getEditionByPeriod(db, "2026-08-08");
    expect(ed?.isLatest).toBe(false);
    expect(ed?.nextPeriod).toBe("2026-08-11");
    expect(ed?.prevPeriod).toBeNull();
  });

  it("中间那组 prevPeriod 与 nextPeriod 同时非 null（生产常态：既非首期也非最新）", async () => {
    const ed = await getEditionByPeriod(db, "2026-08-11");
    expect(ed?.prevPeriod).toBe("2026-08-08");
    expect(ed?.nextPeriod).toBe("2026-08-15");
    expect(ed?.isLatest).toBe(false);
  });

  it("不存在的 period 返回 null", async () => {
    expect(await getEditionByPeriod(db, "2026-01-01")).toBeNull();
  });

  it("title/content 透传获胜期的内容，periodStart/periodEnd/publishedAt 是同一套 ×1000 转换", async () => {
    const ed = await getEditionByPeriod(db, "2026-08-15");
    const a = ed?.sections.find((s) => s.directionSlug === "aaa");
    // 获胜期是 issue=2 的 dg-a-new（"A2"），不是被取代的 dg-a-dup（"A1"）
    expect(a?.title).toEqual(four("A2"));
    expect(a?.content).toEqual(four("A2 body"));
    expect(ed?.periodStart.toISOString()).toBe("2026-08-08T23:59:59.000Z");
    expect(ed?.periodEnd.toISOString()).toBe("2026-08-15T23:59:59.000Z");
    expect(ed?.publishedAt?.toISOString()).toBe("2026-08-18T06:00:00.000Z");
  });
});

describe("getEditionByPeriod on empty db", () => {
  it("空库 + period=null 返回 null（target 兜底守卫：Math.min(...[]) 不会被算进去）", async () => {
    const db = createTestDb().db; // 不 seed
    expect(await getEditionByPeriod(db, null)).toBeNull();
  });
});

describe("listEditionPeriods", () => {
  it("按 period 倒序，方向数去重、篇数不含软删", async () => {
    const db = createTestDb().db;
    await seed(db);
    const list = await listEditionPeriods(db);
    expect(list.map((e) => e.period)).toEqual([
      "2026-08-15",
      "2026-08-11",
      "2026-08-08",
    ]);
    expect(list[0].directionCount).toBe(2);
    // dg-a-new 4 + dg-b-new 1，p4 已软删；dg-a-dup 的 2 篇（p7/p8）不计入——
    // 这条与下面的「等于各栏目 pickCount 之和」是同一个不变式的两种写法。
    expect(list[0].pickCount).toBe(5);
    expect(list[0].periodStart.toISOString()).toBe("2026-08-08T23:59:59.000Z");
    expect(list[0].periodEnd.toISOString()).toBe("2026-08-15T23:59:59.000Z");
    expect(list[0].publishedAt?.toISOString()).toBe("2026-08-18T06:00:00.000Z");
  });

  // Critical 回归锁：dg-a-dup 是被 dg-a-new 取代的补跑残留期，自己也带 2 篇
  // picks（p7/p8，见 seed 里的注释）。listEditionPeriods 曾经对全组
  // published digests 聚合 pickCount，不排除被取代的残留期，导致这里算出
  // 7（4+1+2）而 getEditionByPeriod 的栏目合计只有 5（4+1）——页尾「N 篇」
  // 与点进 /gallery/w/$period 数出来的不是同一个数。两个函数必须共用同一套
  // 「获胜集合」判定（见 edition-store.ts 的 isWinningDigest）。
  it("pickCount 只计获胜 digest 的 picks，等于 getEditionByPeriod 各栏目 pickCount 之和", async () => {
    const db = createTestDb().db;
    await seed(db);
    const ed = await getEditionByPeriod(db, "2026-08-15");
    const sectionsTotal = ed?.sections.reduce((sum, s) => sum + s.pickCount, 0);
    const list = await listEditionPeriods(db);
    const thisPeriod = list.find((e) => e.period === "2026-08-15");
    expect(sectionsTotal).toBe(5);
    expect(thisPeriod?.pickCount).toBe(sectionsTotal);
  });
});
