import { beforeAll, describe, expect, it } from "vitest";
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
import { createTestDb } from "../../../../test/helpers/sqlite-d1";
import { digestRouter, excerptFromMarkdown } from "./digest";

type Db = ReturnType<typeof createTestDb>["db"];

const PERIOD_START = new Date("2026-07-27T00:00:00Z");
const PERIOD_END = new Date("2026-08-03T00:00:00Z");

const ISSUE_2_CONTENT = [
  "# 第 2 期",
  "",
  "本期看点：[形式化数学](https://arxiv.org/abs/2607.00001) 有**实质**进展",
  "",
  "更多内容。",
].join("\n");

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
  // 三个用户：paper_feedback 的 (paperId, userId) 唯一，一篇论文上凑赞+踩需要三个人
  await db.insert(user).values(
    ["u1", "u2", "u3"].map((id) => ({
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
      focusBrief: "自动定理证明与形式化数学",
      isActive: true,
      sortOrder: 0,
    },
    {
      id: "dir-b",
      slug: "no-issues-yet",
      name: four("Fresh"),
      focusBrief: "还没出过期",
      isActive: true,
      sortOrder: 1,
    },
    {
      id: "dir-hidden",
      slug: "retired",
      name: four("Retired"),
      focusBrief: "已下线方向",
      isActive: false,
      sortOrder: 2,
    },
  ]);

  await db.insert(digests).values([
    {
      id: "dg-1",
      directionId: "dir-a",
      issueNumber: 1,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      status: "published",
      title: four("Issue 1"),
      content: four("Issue 1 body"),
      workflowInstanceId: "wf-1",
      publishedAt: new Date("2026-08-03T01:00:00Z"),
    },
    {
      id: "dg-2",
      directionId: "dir-a",
      issueNumber: 2,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      status: "published",
      title: four("Issue 2"),
      content: { ...four("Issue 2 body"), "zh-cn": ISSUE_2_CONTENT },
      proposedFocusUpdate: "内部草稿：把重心挪向 Lean 4 生态",
      workflowInstanceId: "wf-2",
      publishedAt: new Date("2026-08-10T01:00:00Z"),
    },
    {
      id: "dg-3",
      directionId: "dir-a",
      issueNumber: 3,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      status: "generating",
      title: four("Issue 3"),
      content: four("Issue 3 body"),
      workflowInstanceId: "wf-3",
    },
    {
      id: "dg-4",
      directionId: "dir-a",
      issueNumber: 4,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      status: "failed",
      title: four("Issue 4"),
      content: four("Issue 4 body"),
      workflowInstanceId: "wf-4",
    },
    // 已下线方向也有 published 期，用于验证 listDirections 不带出它
    {
      id: "dg-hidden",
      directionId: "dir-hidden",
      issueNumber: 1,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      status: "published",
      title: four("Retired issue"),
      content: four("Retired body"),
      workflowInstanceId: "wf-hidden",
      publishedAt: new Date("2026-08-03T01:00:00Z"),
    },
  ]);

  for (const [id, shortId, title] of [
    ["p1", "sid1", "Paper One"],
    ["p2", "sid2", "Paper Two"],
    ["p3", "sid3", "Deleted Paper"],
  ]) {
    await db.insert(papers).values({
      id,
      shortId,
      userId: "u1",
      title,
      sourceType: "arxiv",
      pdfR2Key: `papers/${id}.pdf`,
      fileSize: 1,
      status: "completed",
      isPublic: true,
      isListedInGallery: true,
      // p3 已软删：/p/sid3 已 404，简报页不该再渲染它
      deletedAt: id === "p3" ? new Date("2026-08-09T00:00:00Z") : null,
    });
  }

  // p1 有两张默认白板 + 两行 paper_results（历史脏数据）：groupBy 必须收敛成一行
  await db.insert(whiteboardImages).values([
    { id: "wb-1", paperId: "p1", imageR2Key: "wb/p1-a.png", isDefault: true },
    { id: "wb-2", paperId: "p1", imageR2Key: "wb/p1-b.png", isDefault: true },
    { id: "wb-3", paperId: "p1", imageR2Key: "wb/p1-c.png", isDefault: false },
    // 软删论文也有白板：守卫缺失时会连 R2 key 一起泄漏出去
    { id: "wb-4", paperId: "p3", imageR2Key: "wb/p3.png", isDefault: true },
  ]);
  await db.insert(paperResults).values([
    {
      id: "pr-1",
      paperId: "p1",
      summaries: four("summary"),
      tldr: four("tldr p1"),
    },
    {
      id: "pr-2",
      paperId: "p1",
      summaries: four("summary dup"),
      tldr: four("tldr p1 dup"),
    },
  ]);

  await db.insert(digestPapers).values([
    {
      digestId: "dg-2",
      paperId: "p2",
      rank: 2,
      recommendationNote: four("note p2"),
    },
    {
      digestId: "dg-2",
      paperId: "p1",
      rank: 1,
      recommendationNote: four("note p1"),
    },
    {
      digestId: "dg-2",
      paperId: "p3",
      rank: 3,
      recommendationNote: four("note p3"),
    },
  ]);

  // p1: 两个赞 + 一个踩；p2: 一个踩。likeCount 只数 vote = 1
  await db.insert(paperFeedback).values([
    { id: "fb-1", paperId: "p1", userId: "u1", vote: 1 },
    { id: "fb-2", paperId: "p1", userId: "u2", vote: 1 },
    { id: "fb-3", paperId: "p1", userId: "u3", vote: -1 },
    { id: "fb-4", paperId: "p2", userId: "u1", vote: -1 },
  ]);
}

let caller: ReturnType<typeof digestRouter.createCaller>;

beforeAll(async () => {
  const { db } = createTestDb();
  await seed(db);
  caller = digestRouter.createCaller({ db } as never);
});

describe("digest.getIssue", () => {
  it("returns the published issue with its papers ordered by rank", async () => {
    const issue = await caller.getIssue({
      slug: "ai4formath",
      issueNumber: 2,
      locale: "zh-CN",
    });

    expect(issue).not.toBeNull();
    expect(issue?.directionSlug).toBe("ai4formath");
    expect(issue?.directionName).toBe("AI4Math zh-cn");
    expect(issue?.title).toBe("Issue 2 zh-cn");
    expect(issue?.content).toBe(ISSUE_2_CONTENT);
    expect(issue?.papers.map((p) => p.rank)).toEqual([1, 2]);
    expect(issue?.papers.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(issue?.papers[0]).toMatchObject({
      shortId: "sid1",
      title: "Paper One",
      tldr: "tldr p1 zh-cn",
      recommendationNote: "note p1 zh-cn",
      likeCount: 2,
    });
    // 一篇论文即使有多张默认白板 / 多行 paper_results 也只出一行
    expect(issue?.papers[0].whiteboardImageR2Key).toMatch(/^wb\/p1-[ab]\.png$/);
    // 白板未生成的论文走 leftJoin 保留，图为 null，且踩不计入 likeCount
    expect(issue?.papers[1]).toMatchObject({
      id: "p2",
      whiteboardImageR2Key: null,
      tldr: "",
      likeCount: 0,
    });
  });

  it("links only to neighbouring published issues", async () => {
    const issue2 = await caller.getIssue({
      slug: "ai4formath",
      issueNumber: 2,
    });
    // 第 3/4 期是 generating/failed，不能成为「下一期」
    expect(issue2?.prevIssue).toBe(1);
    expect(issue2?.nextIssue).toBeNull();

    const issue1 = await caller.getIssue({
      slug: "ai4formath",
      issueNumber: 1,
    });
    expect(issue1?.prevIssue).toBeNull();
    expect(issue1?.nextIssue).toBe(2);
  });

  it("omits soft-deleted papers from the issue's paper list", async () => {
    // p3 是 dg-2 的 rank 3 入选论文但已软删：标题与白板 R2 key 都不该再对外渲染
    const issue = await caller.getIssue({
      slug: "ai4formath",
      issueNumber: 2,
    });
    expect(issue?.papers.map((p) => p.id)).not.toContain("p3");
    expect(JSON.stringify(issue)).not.toContain("Deleted Paper");
    expect(JSON.stringify(issue)).not.toContain("wb/p3.png");
  });

  it("hides issues that are not published", async () => {
    await expect(
      caller.getIssue({ slug: "ai4formath", issueNumber: 3 }),
    ).resolves.toBeNull();
    await expect(
      caller.getIssue({ slug: "ai4formath", issueNumber: 4 }),
    ).resolves.toBeNull();
  });

  it("returns null for unknown slugs and issue numbers", async () => {
    await expect(
      caller.getIssue({ slug: "nope", issueNumber: 1 }),
    ).resolves.toBeNull();
    await expect(
      caller.getIssue({ slug: "ai4formath", issueNumber: 99 }),
    ).resolves.toBeNull();
  });

  it("never leaks internal digest fields", async () => {
    const issue = await caller.getIssue({
      slug: "ai4formath",
      issueNumber: 2,
    });
    expect(Object.keys(issue ?? {}).sort()).toEqual([
      "content",
      "directionName",
      "directionSlug",
      "issueNumber",
      "nextIssue",
      "papers",
      "periodEnd",
      "periodStart",
      "prevIssue",
      "publishedAt",
      "title",
    ]);
    for (const key of [
      "proposedFocusUpdate",
      "workflowInstanceId",
      "status",
      "id",
      "directionId",
    ]) {
      expect(issue).not.toHaveProperty(key);
    }
    // 序列化后的整个响应里也不该出现内部草稿文本
    expect(JSON.stringify(issue)).not.toContain("内部草稿");
    expect(Object.keys(issue?.papers[0] ?? {}).sort()).toEqual([
      "id",
      "likeCount",
      "rank",
      "recommendationNote",
      "shortId",
      "title",
      "tldr",
      "whiteboardImageR2Key",
    ]);
  });
});

describe("digest.listDirections", () => {
  it("lists active directions with their latest published issue", async () => {
    const dirs = await caller.listDirections({ locale: "ja" });
    expect(dirs.map((d) => d.slug)).toEqual(["ai4formath", "no-issues-yet"]);
    expect(dirs[0]).toEqual({
      slug: "ai4formath",
      name: "AI4Math ja",
      latestIssue: {
        issueNumber: 2,
        title: "Issue 2 ja",
        publishedAt: new Date("2026-08-10T01:00:00Z"),
      },
    });
    // 没有任何 published 期的方向，latestIssue 为 null
    expect(dirs[1].latestIssue).toBeNull();
  });

  it("excludes inactive directions even when they have published issues", async () => {
    const dirs = await caller.listDirections({});
    expect(dirs.map((d) => d.slug)).not.toContain("retired");
  });
});

describe("digest.getDirection", () => {
  it("returns published issues newest first plus an excerpt of the latest", async () => {
    const detail = await caller.getDirection({
      slug: "ai4formath",
      locale: "zh-CN",
    });
    expect(detail?.name).toBe("AI4Math zh-cn");
    expect(detail?.focusBrief).toBe("自动定理证明与形式化数学");
    expect(detail?.issues.map((i) => i.issueNumber)).toEqual([2, 1]);
    expect(detail?.latestExcerpt).toBe("本期看点：形式化数学 有实质进展");
    // 只下发摘要，不把整期四语 markdown 打给客户端
    expect(Object.keys(detail ?? {}).sort()).toEqual([
      "focusBrief",
      "issues",
      "latestExcerpt",
      "name",
      "slug",
    ]);
    expect(JSON.stringify(detail)).not.toContain("更多内容");
  });

  it("returns null for inactive or unknown directions", async () => {
    await expect(caller.getDirection({ slug: "retired" })).resolves.toBeNull();
    await expect(caller.getDirection({ slug: "nope" })).resolves.toBeNull();
  });
});

describe("excerptFromMarkdown", () => {
  it("skips heading and blank lines", () => {
    expect(excerptFromMarkdown("# Title\n\n## Sub\n\nFirst body line.")).toBe(
      "First body line.",
    );
  });

  it("strips inline link syntax and emphasis markers", () => {
    expect(excerptFromMarkdown("> see [the paper](https://a.b/c) *now*")).toBe(
      "see the paper now",
    );
  });

  it("truncates to 160 characters with an ellipsis", () => {
    const out = excerptFromMarkdown("x".repeat(200));
    expect(out).toHaveLength(161);
    expect(out.endsWith("…")).toBe(true);
    expect(excerptFromMarkdown("y".repeat(160))).toBe("y".repeat(160));
  });

  it("returns an empty string for empty or heading-only input", () => {
    expect(excerptFromMarkdown(null)).toBe("");
    expect(excerptFromMarkdown(undefined)).toBe("");
    expect(excerptFromMarkdown("# only a heading\n\n")).toBe("");
  });
});
