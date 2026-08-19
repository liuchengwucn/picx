/**
 * paper 路由的方向筛选 / 赞数 / 反馈三件套。
 *
 * 跑在真 SQLite 上(见 test/helpers/sqlite-d1)而非 mock 链: 改票要验的是 upsert
 * 真走了 onConflictDoUpdate(表里只剩一行), 方向筛选要验的是关联 EXISTS 子查询
 * (digest_papers.paper_id = papers.id 的表限定符是否真在), likeCount 要验的是
 * 关联子查询只数 vote = 1 —— 这些都只有 SQL 真跑一遍才看得见。
 */

import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  digestPapers,
  digests,
  directions,
  paperFeedback,
  paperResults,
  papers,
  user,
  whiteboardImages,
} from "#/db/schema";
import { REVIEW_GUEST_USER_ID } from "#/lib/review-guest";
import { createTestDb } from "../../../../test/helpers/sqlite-d1";
import { digestRouter } from "./digest";
import { paperRouter } from "./paper";

type Db = ReturnType<typeof createTestDb>["db"];

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
  await db.insert(user).values(
    ["u1", "u2", REVIEW_GUEST_USER_ID].map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
      createdAt: now,
      updatedAt: now,
    })),
  );

  await db.insert(directions).values([
    {
      id: "dir-a",
      slug: "ai4formath",
      name: four("AI4Math"),
      focusBrief: "自动定理证明",
      isActive: true,
      sortOrder: 0,
    },
    {
      id: "dir-b",
      slug: "agents",
      name: four("Agents"),
      focusBrief: "智能体",
      isActive: true,
      sortOrder: 1,
    },
  ]);

  // 三个可见性开关各有一篇反例: setFeedback 的守卫三条都要挡, listPublic 同理
  const paperRows: Array<{
    id: string;
    directionId: string | null;
    isPublic?: boolean;
    isListed?: boolean;
    deletedAt?: Date;
    day: number;
  }> = [
    { id: "p-a1", directionId: "dir-a", day: 1 },
    { id: "p-a2", directionId: "dir-a", day: 2 },
    { id: "p-b1", directionId: "dir-b", day: 3 },
    // 无方向(HF 爆款兜底 / 历史论文): directionSlug 应为 null, 且不被任何方向筛出
    { id: "p-none", directionId: null, day: 4 },
    // 未公开: 不能被投票(否则可用 NOT_FOUND/成功 探测他人私有论文)
    { id: "p-private", directionId: "dir-a", isPublic: false, day: 5 },
    // 已下架(仍 isPublic, 但不在画廊里): 卡片都看不到, 更不该能投票
    { id: "p-unlisted", directionId: "dir-a", isListed: false, day: 6 },
    // 已软删: /p/$shortId 已 404
    {
      id: "p-deleted",
      directionId: "dir-a",
      deletedAt: new Date("2026-08-09T00:00:00Z"),
      day: 7,
    },
  ];

  for (const row of paperRows) {
    await db.insert(papers).values({
      id: row.id,
      shortId: `sid-${row.id}`,
      userId: "u1",
      title: `Paper ${row.id}`,
      sourceType: "arxiv",
      pdfR2Key: `papers/${row.id}.pdf`,
      fileSize: 1,
      status: "completed",
      isPublic: row.isPublic ?? true,
      isListedInGallery: row.isListed ?? true,
      deletedAt: row.deletedAt ?? null,
      directionId: row.directionId,
      publishedAt: new Date(Date.UTC(2026, 7, row.day)),
    });
    await db.insert(whiteboardImages).values({
      id: `wb-${row.id}`,
      paperId: row.id,
      imageR2Key: `wb/${row.id}.png`,
      isDefault: true,
    });
  }

  // 方向页论文流的口径是「被该方向已出刊(published)各期引用过」, 不是
  // papers.direction_id: 给两个方向各出一期已发布刊, 把上面的论文都挂进去
  // (p-private/p-unlisted/p-deleted 也挂, 让它们被挡是因为可见性而非缺引用)
  await db.insert(digests).values([
    {
      id: "dg-a-1",
      directionId: "dir-a",
      issueNumber: 1,
      periodStart: new Date(Date.UTC(2026, 7, 1)),
      periodEnd: new Date(Date.UTC(2026, 7, 8)),
      status: "published",
      workflowInstanceId: "wf-a-1",
      publishedAt: now,
    },
    {
      id: "dg-b-1",
      directionId: "dir-b",
      issueNumber: 1,
      periodStart: new Date(Date.UTC(2026, 7, 1)),
      periodEnd: new Date(Date.UTC(2026, 7, 8)),
      status: "published",
      workflowInstanceId: "wf-b-1",
      publishedAt: now,
    },
  ]);
  await db.insert(digestPapers).values([
    { digestId: "dg-a-1", paperId: "p-a1", rank: 1 },
    { digestId: "dg-a-1", paperId: "p-a2", rank: 2 },
    { digestId: "dg-a-1", paperId: "p-private", rank: 3 },
    { digestId: "dg-a-1", paperId: "p-unlisted", rank: 4 },
    { digestId: "dg-a-1", paperId: "p-deleted", rank: 5 },
    { digestId: "dg-b-1", paperId: "p-b1", rank: 1 },
  ]);

  await db.insert(paperResults).values({
    id: "pr-a1",
    paperId: "p-a1",
    summaries: four("summary"),
    tldr: four("tldr a1"),
  });

  // p-a1: 一个赞(u2) + 一个踩(guest) => likeCount 必须是 1, 不是 2
  await db.insert(paperFeedback).values([
    { id: "fb-1", paperId: "p-a1", userId: "u2", vote: 1 },
    { id: "fb-2", paperId: "p-a1", userId: REVIEW_GUEST_USER_ID, vote: -1 },
  ]);
}

/** 共享 seed 之外追加一篇画廊可见论文(卡片必须有默认白板才会被列出) */
async function insertGalleryPaper(
  db: Db,
  id: string,
  directionId: string | null,
  day: number,
) {
  await db.insert(papers).values({
    id,
    shortId: `sid-${id}`,
    userId: "u1",
    title: `Paper ${id}`,
    sourceType: "arxiv",
    pdfR2Key: `papers/${id}.pdf`,
    fileSize: 1,
    status: "completed",
    isPublic: true,
    isListedInGallery: true,
    directionId,
    publishedAt: new Date(Date.UTC(2026, 7, day)),
  });
  await db.insert(whiteboardImages).values({
    id: `wb-${id}`,
    paperId: id,
    imageR2Key: `wb/${id}.png`,
    isDefault: true,
  });
}

let db: Db;

/** 传 null 模拟未登录 */
function createCaller(userId: string | null) {
  return paperRouter.createCaller({
    db,
    headers: new Headers(),
    env: {},
    auth: {
      api: {
        getSession: vi
          .fn()
          .mockResolvedValue(userId ? { user: { id: userId } } : null),
      },
    },
  } as never);
}

function myFeedbackRows(paperId: string, userId: string) {
  return db
    .select()
    .from(paperFeedback)
    .where(
      and(eq(paperFeedback.paperId, paperId), eq(paperFeedback.userId, userId)),
    );
}

beforeEach(async () => {
  db = createTestDb().db;
  await seed(db);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("paper.setFeedback", () => {
  it("rejects anonymous callers", async () => {
    await expect(
      createCaller(null).setFeedback({ paperId: "p-a1", vote: 1 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // 未登录不该在库里留下任何痕迹
    await expect(db.select().from(paperFeedback)).resolves.toHaveLength(2);
  });

  it("rejects papers that are not publicly listed", async () => {
    await expect(
      createCaller("u1").setFeedback({ paperId: "p-private", vote: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createCaller("u1").setFeedback({ paperId: "does-not-exist", vote: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(myFeedbackRows("p-private", "u1")).resolves.toHaveLength(0);
  });

  it("rejects papers that are no longer listed in the gallery", async () => {
    // 下架的论文在画廊里已无卡片, 陈旧页面/直接调 API 都不该还能投票
    await expect(
      createCaller("u1").setFeedback({ paperId: "p-unlisted", vote: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(myFeedbackRows("p-unlisted", "u1")).resolves.toHaveLength(0);
  });

  it("rejects soft-deleted papers", async () => {
    await expect(
      createCaller("u1").setFeedback({ paperId: "p-deleted", vote: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(myFeedbackRows("p-deleted", "u1")).resolves.toHaveLength(0);
  });

  it("upserts instead of inserting when the same user votes again", async () => {
    const caller = createCaller("u1");
    await caller.setFeedback({ paperId: "p-a1", vote: 1 });
    await caller.setFeedback({
      paperId: "p-a1",
      vote: -1,
      reasonPreset: "incremental",
      reasonText: "只是把 baseline 换了个数据集",
    });

    const rows = await myFeedbackRows("p-a1", "u1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vote: -1,
      reasonPreset: "incremental",
      reasonText: "只是把 baseline 换了个数据集",
    });
    // 别人的反馈没被 upsert 顺手覆盖
    await expect(myFeedbackRows("p-a1", "u2")).resolves.toMatchObject([
      { vote: 1 },
    ]);
  });

  it("clears a stale reason when the new vote carries none", async () => {
    const caller = createCaller("u1");
    await caller.setFeedback({
      paperId: "p-a1",
      vote: -1,
      reasonPreset: "hype",
      reasonText: "标题党",
    });
    await caller.setFeedback({ paperId: "p-a1", vote: 1 });

    await expect(myFeedbackRows("p-a1", "u1")).resolves.toMatchObject([
      { vote: 1, reasonPreset: null, reasonText: null },
    ]);
  });

  it("rejects a reason longer than 500 characters", async () => {
    await expect(
      createCaller("u1").setFeedback({
        paperId: "p-a1",
        vote: -1,
        reasonText: "x".repeat(501),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(myFeedbackRows("p-a1", "u1")).resolves.toHaveLength(0);
  });

  it("rejects the read-only review guest", async () => {
    vi.stubEnv("VITE_ENABLE_REVIEW_GUEST", "1");
    await expect(
      createCaller(REVIEW_GUEST_USER_ID).setFeedback({
        paperId: "p-a2",
        vote: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      myFeedbackRows("p-a2", REVIEW_GUEST_USER_ID),
    ).resolves.toHaveLength(0);
  });
});

describe("paper.clearFeedback", () => {
  it("removes only the caller's own vote", async () => {
    const caller = createCaller("u1");
    await caller.setFeedback({ paperId: "p-a1", vote: 1 });
    await caller.setFeedback({ paperId: "p-a2", vote: 1 });

    await expect(caller.clearFeedback({ paperId: "p-a1" })).resolves.toEqual({
      ok: true,
    });

    await expect(
      caller.getMyFeedback({ paperIds: ["p-a1", "p-a2"] }),
    ).resolves.toEqual({ "p-a2": { vote: 1, reasonPreset: null } });
    // 同一篇论文上别人的赞不受影响
    await expect(myFeedbackRows("p-a1", "u2")).resolves.toHaveLength(1);
  });

  it("is idempotent when there is nothing to clear", async () => {
    await expect(
      createCaller("u1").clearFeedback({ paperId: "p-a1" }),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects the read-only review guest", async () => {
    vi.stubEnv("VITE_ENABLE_REVIEW_GUEST", "1");
    await expect(
      createCaller(REVIEW_GUEST_USER_ID).clearFeedback({ paperId: "p-a1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // guest 原有的踩票还在
    await expect(
      myFeedbackRows("p-a1", REVIEW_GUEST_USER_ID),
    ).resolves.toHaveLength(1);
  });
});

describe("paper.getMyFeedback", () => {
  it("returns a map keyed by paper id for the caller only", async () => {
    const caller = createCaller("u1");
    await caller.setFeedback({
      paperId: "p-a1",
      vote: -1,
      reasonPreset: "seen",
    });

    await expect(
      caller.getMyFeedback({ paperIds: ["p-a1", "p-a2", "p-b1"] }),
    ).resolves.toEqual({ "p-a1": { vote: -1, reasonPreset: "seen" } });
    // u2 的赞不会串到 u1 的结果里, 反之亦然
    await expect(
      createCaller("u2").getMyFeedback({ paperIds: ["p-a1"] }),
    ).resolves.toEqual({ "p-a1": { vote: 1, reasonPreset: null } });
  });

  it("rejects anonymous callers and oversized batches", async () => {
    await expect(
      createCaller(null).getMyFeedback({ paperIds: ["p-a1"] }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // D1 单查询绑定参数上限 100, 批量上限必须挡在 90
    await expect(
      createCaller("u1").getMyFeedback({
        paperIds: Array.from({ length: 91 }, (_, i) => `p-${i}`),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

/**
 * 方向页统计行印的 paperCount 与它正下方那一列卡片必须是同一批论文。
 *
 * 这条用例存在的理由是「同步义务不能只写在注释里」: 两个口径分叉过一次(方向页
 * 「18 篇入选论文」配 2 张卡), 而 digest.test.ts 断言的是手算常数 —— 改
 * listPublic 的可见性条件时那一套仍会全绿。所以在这里让两个 procedure 跑在同一个
 * 库上对答案: 任一侧的谓词漂了, 这里就红。
 *
 * 放在本文件而不是 digest.test.ts: 只有这里同时有 digest 夹具与 paperRouter。
 */
describe("paperCount stays tied to paper.listPublic", () => {
  it("reports exactly as many papers as the direction's gallery stream lists", async () => {
    const digestCaller = digestRouter.createCaller({ db } as never);
    const [detail, listed] = await Promise.all([
      digestCaller.getDirection({ slug: "ai4formath" }),
      createCaller(null).listPublic({ direction: "ai4formath" }),
    ]);
    // 夹具里 dir-a 出刊引用了 5 篇, 其中 private/unlisted/deleted 三篇画廊流列不出来
    expect(listed.total).toBe(2);
    expect(detail?.paperCount).toBe(listed.total);
  });

  it("keeps both sides in step for a pick that has no default whiteboard", async () => {
    // 白板那一层是上次真正漏掉的东西(缺的是 innerJoin, 不是布尔标志), 所以单独给它
    // 一篇夹具: 可见性全过、被已发布期引用, 只是没有默认白板。
    await db.insert(papers).values({
      id: "p-nowb",
      shortId: "sid-p-nowb",
      userId: "u1",
      title: "Picked but imageless",
      sourceType: "arxiv",
      pdfR2Key: "papers/p-nowb.pdf",
      fileSize: 1,
      status: "completed",
      isPublic: true,
      isListedInGallery: true,
      directionId: "dir-a",
      publishedAt: new Date(Date.UTC(2026, 7, 20)),
    });
    await db
      .insert(digestPapers)
      .values({ digestId: "dg-a-1", paperId: "p-nowb", rank: 6 });

    const digestCaller = digestRouter.createCaller({ db } as never);
    const [detail, listed] = await Promise.all([
      digestCaller.getDirection({ slug: "ai4formath" }),
      createCaller(null).listPublic({ direction: "ai4formath" }),
    ]);
    // 两边都不数它 —— 关键是「两边一致」, 常数只是顺手钉住当前值
    expect(listed.papers.map((p) => p.id)).not.toContain("p-nowb");
    expect(listed.total).toBe(2);
    expect(detail?.paperCount).toBe(listed.total);
  });
});

describe("paper.listPublic direction filter", () => {
  it("returns only papers of the requested direction", async () => {
    const caller = createCaller(null);
    const result = await caller.listPublic({ direction: "ai4formath" });

    // p-private 不公开, p-unlisted 已下架, p-deleted 已软删, p-b1/p-none 不在该方向
    expect(result.papers.map((p) => p.id)).toEqual(["p-a2", "p-a1"]);
    expect(result.total).toBe(2);
    expect(result.papers.every((p) => p.directionSlug === "ai4formath")).toBe(
      true,
    );
  });

  it("returns an empty page for an unknown direction slug", async () => {
    const result = await createCaller(null).listPublic({ direction: "nope" });
    expect(result.papers).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("keeps unfiltered listing intact, with likeCount and directionSlug", async () => {
    const result = await createCaller(null).listPublic({ locale: "zh-CN" });

    expect(result.total).toBe(4);
    expect(result.papers.map((p) => p.id)).toEqual([
      "p-none",
      "p-b1",
      "p-a2",
      "p-a1",
    ]);
    // 一个赞 + 一个踩 => likeCount 只数 vote = 1
    expect(result.papers.at(-1)).toMatchObject({
      id: "p-a1",
      directionSlug: "ai4formath",
      likeCount: 1,
      tldr: "tldr a1 zh-cn",
    });
    // 无方向论文走 leftJoin 保留, slug 为 null
    expect(result.papers[0]).toMatchObject({
      id: "p-none",
      directionSlug: null,
      likeCount: 0,
    });
  });

  it("hides retired directions: slug becomes null and filter returns nothing", async () => {
    // 追加一个已下线方向及其论文(不进共享 seed, 免得动别的用例的计数)。
    // 论文挂在一期 published 刊上: 空结果只能是 isActive 闸的功劳
    await db.insert(directions).values({
      id: "dir-r",
      slug: "retired",
      name: four("Retired"),
      focusBrief: "已下线",
      isActive: false,
      sortOrder: 2,
    });
    await insertGalleryPaper(db, "p-r", "dir-r", 8);
    await db.insert(digests).values({
      id: "dg-r-1",
      directionId: "dir-r",
      issueNumber: 1,
      periodStart: new Date(Date.UTC(2026, 7, 1)),
      periodEnd: new Date(Date.UTC(2026, 7, 8)),
      status: "published",
      workflowInstanceId: "wf-r-1",
      publishedAt: new Date(),
    });
    await db.insert(digestPapers).values({
      digestId: "dg-r-1",
      paperId: "p-r",
      rank: 1,
    });

    const caller = createCaller(null);

    // 论文照常列出, 但 directionSlug 为 null => 前端不会渲染指向 404 的方向徽标
    const listed = await caller.listPublic({});
    expect(listed.total).toBe(5);
    expect(listed.papers[0]).toMatchObject({ id: "p-r", directionSlug: null });

    // 已下线方向对外口径是「不存在」: 用它的 slug 过滤返回空集
    await expect(
      caller.listPublic({ direction: "retired" }),
    ).resolves.toMatchObject({ total: 0, papers: [] });
  });

  it("excludes orphans: direction_id without any digest citation is not enough", async () => {
    // 本次修的 bug: pool 重放删除重建 digests 后, digest_papers 级联清空而
    // papers 行保留 => 论文带着 direction_id 却不属于任何一期。方向页不该列它
    await insertGalleryPaper(db, "p-orphan", "dir-a", 9);

    const caller = createCaller(null);
    const filtered = await caller.listPublic({ direction: "ai4formath" });
    expect(filtered.papers.map((p) => p.id)).toEqual(["p-a2", "p-a1"]);
    expect(filtered.total).toBe(2);

    // 不传 direction 的总流口径不变: 孤儿论文照常可见
    const unfiltered = await caller.listPublic({});
    expect(unfiltered.total).toBe(5);
    expect(unfiltered.papers[0]).toMatchObject({
      id: "p-orphan",
      directionSlug: "ai4formath",
    });
  });

  it("ignores citations from digests that are not published", async () => {
    // generating/failed 期的 picks 不该提前出现在公开方向页
    await insertGalleryPaper(db, "p-draft", "dir-a", 9);
    await db.insert(digests).values({
      id: "dg-a-2",
      directionId: "dir-a",
      issueNumber: 2,
      periodStart: new Date(Date.UTC(2026, 7, 8)),
      periodEnd: new Date(Date.UTC(2026, 7, 15)),
      status: "generating",
      workflowInstanceId: "wf-a-2",
    });
    await db.insert(digestPapers).values({
      digestId: "dg-a-2",
      paperId: "p-draft",
      rank: 1,
    });

    await expect(
      createCaller(null).listPublic({ direction: "ai4formath" }),
    ).resolves.toMatchObject({
      total: 2,
      papers: [{ id: "p-a2" }, { id: "p-a1" }],
    });
  });

  it("lists a paper cited by multiple published issues exactly once", async () => {
    // EXISTS + groupBy(papers.id) 结构上不会重复; 钉住这一点, 防未来重构
    // (比如有人把 EXISTS 改成 innerJoin digest_papers)把多期引用扇出成多行
    await db.insert(digests).values({
      id: "dg-a-3",
      directionId: "dir-a",
      issueNumber: 3,
      periodStart: new Date(Date.UTC(2026, 7, 15)),
      periodEnd: new Date(Date.UTC(2026, 7, 22)),
      status: "published",
      workflowInstanceId: "wf-a-3",
      publishedAt: new Date(),
    });
    await db.insert(digestPapers).values({
      digestId: "dg-a-3",
      paperId: "p-a1",
      rank: 1,
    });

    const result = await createCaller(null).listPublic({
      direction: "ai4formath",
    });
    expect(result.papers.map((p) => p.id)).toEqual(["p-a2", "p-a1"]);
    expect(result.total).toBe(2);
  });

  it("lists papers cited across directions regardless of direction_id", async () => {
    // 有意语义: 方向页 = 该方向刊物引用过的论文, 与建行来源(direction_id)
    // 无关。direction_id 为 NULL(HF 兜底)或指向别的方向, 只要被 dir-a 的
    // published 期引用就出现在 dir-a 方向页
    await insertGalleryPaper(db, "p-cross", null, 9);
    await db.insert(digestPapers).values({
      digestId: "dg-a-1",
      paperId: "p-cross",
      rank: 6,
    });

    const result = await createCaller(null).listPublic({
      direction: "ai4formath",
    });
    expect(result.papers.map((p) => p.id)).toEqual(["p-cross", "p-a2", "p-a1"]);
    expect(result.total).toBe(3);
    // 徽章 slug 仍来自 direction_id 的 leftJoin, 与过滤口径无关
    expect(result.papers[0]).toMatchObject({ directionSlug: null });
  });

  it("still honours the other filters alongside direction", async () => {
    const caller = createCaller(null);
    await expect(
      caller.listPublic({ direction: "ai4formath", q: "p-a2" }),
    ).resolves.toMatchObject({ total: 1, papers: [{ id: "p-a2" }] });
    // q 命中的论文属于别的方向时, 两个条件是 AND
    await expect(
      caller.listPublic({ direction: "ai4formath", q: "p-b1" }),
    ).resolves.toMatchObject({ total: 0, papers: [] });
  });
});

describe("paper.listPublic search locale fallback", () => {
  // 回归用例: 早先的实现只探当前 locale 那一个 JSON 键, 而展示层 resolveTldr
  // 缺当前语言时会回退 en 显示 —— 于是用户搜一个屏幕上看得见的英文词, 在没有
  // 日文 tldr 的论文上会得 0 结果。p-a1(共享 seed 里)四语 tldr 齐全, 不足以
  // 复现这条 bug(它自己的 ja 键本来就命中), 所以这里单独插一篇只有 en tldr
  // 的论文。
  it("finds an English-only tldr when searching in a locale that lacks it", async () => {
    await insertGalleryPaper(db, "p-en-only", null, 9);
    await db.insert(paperResults).values({
      id: "pr-en-only",
      paperId: "p-en-only",
      summaries: { en: "A quantum entanglement summary." },
      tldr: { en: "Quantum entanglement breakthrough" },
    });

    const result = await createCaller(null).listPublic({
      q: "quantum",
      locale: "ja",
    });
    expect(result.papers.map((p) => p.id)).toEqual(["p-en-only"]);
    // total 与列表查询共用同一个 baseConditions 数组: 这条断言两处都要吃到
    // 新增的搜索条件, 否则会出现「有结果但 total 不等于返回条数」的矛盾响应
    expect(result.total).toBe(1);
    expect(result.total).toBe(result.papers.length);
  });
});
