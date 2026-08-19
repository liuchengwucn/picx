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
import { excerptByLocale, excerptFromMarkdown } from "#/lib/digest/present";
import { TIMELINE_PAGE_SIZE } from "#/lib/digest/store";
import { createTestDb } from "../../../../test/helpers/sqlite-d1";
import { digestRouter } from "./digest";

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
      intro: four("Intro"),
      isActive: true,
      sortOrder: 0,
    },
    {
      // intro 有意留空：公开页在四语简介生成前要能回退到 focusBrief
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
    {
      // 只生成了英文的 intro：请求日文时应走 pickTldr 的英文回退
      id: "dir-c",
      slug: "en-only-intro",
      name: four("EnOnly"),
      focusBrief: "只有英文简介",
      intro: { en: "English only intro" },
      isActive: true,
      sortOrder: 3,
    },
    {
      // 时间线分页专用：15 期已发布, 超过 TIMELINE_PAGE_SIZE(12), 用于测
      // getDirection 的 hasMore / before 游标
      id: "dir-many",
      slug: "many-issues",
      name: four("Many"),
      focusBrief: "时间线分页夹具",
      intro: four("ManyIntro"),
      isActive: true,
      sortOrder: 4,
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
    // 与 dg-2(dir-a)同一 date(period_end) 分组的第二个方向：getEdition 合刊
    // 测试要看到两个栏目, 单方向永远测不出「合刊聚合多个方向」这件事
    {
      id: "dg-c-1",
      directionId: "dir-c",
      issueNumber: 1,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      status: "published",
      title: four("C Issue 1"),
      content: four("C body"),
      workflowInstanceId: "wf-c-1",
      publishedAt: new Date("2026-08-03T02:00:00Z"),
    },
  ]);

  // dir-many: 15 期已发布(issue 1..15), 全部落在与 dg-2/dg-c-1 不同的一组
  // date(period_end)(2025-06 早于 2026-08), 免得被 getEdition 的「latest」
  // 分组误吸进去。内容故意是不含 markdown 标记的单行文本, 让 excerpt 等于
  // 原文, 断言不必再过一遍 excerptFromMarkdown 的剥离逻辑。
  const MANY_PERIOD_START = new Date("2025-06-01T00:00:00Z");
  const MANY_PERIOD_END = new Date("2025-06-08T00:00:00Z");
  await db.insert(digests).values(
    Array.from({ length: 15 }, (_, i) => {
      const n = i + 1;
      return {
        id: `dg-m-${n}`,
        directionId: "dir-many",
        issueNumber: n,
        periodStart: MANY_PERIOD_START,
        periodEnd: MANY_PERIOD_END,
        status: "published" as const,
        title: four(`M Issue ${n}`),
        content: four(`M body ${n}`),
        workflowInstanceId: `wf-m-${n}`,
        publishedAt: new Date(
          `2025-06-08T${String(n).padStart(2, "0")}:00:00Z`,
        ),
      };
    }),
  );

  for (const [id, shortId, title] of [
    ["p1", "sid1", "Paper One"],
    ["p2", "sid2", "Paper Two"],
    ["p3", "sid3", "Deleted Paper"],
    // dir-c 的合刊栏目独立引用的一篇（不与 dir-a 共享）
    ["p4", "sid4", "Paper Four"],
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
    {
      digestId: "dg-c-1",
      paperId: "p4",
      rank: 1,
      recommendationNote: four("note p4"),
    },
    // dg-m-1/dg-m-2 都引用 p1：跨期去重的 paperCount 必须把它们算作同一篇
    {
      digestId: "dg-m-1",
      paperId: "p1",
      rank: 1,
      recommendationNote: four("note m1-p1"),
    },
    {
      digestId: "dg-m-1",
      paperId: "p2",
      rank: 2,
      recommendationNote: four("note m1-p2"),
    },
    { digestId: "dg-m-2", paperId: "p1", rank: 1 },
    // dg-m-3 混一篇已软删的 p3：pickCount 与 paperCount 都必须把它排除
    { digestId: "dg-m-3", paperId: "p1", rank: 1 },
    { digestId: "dg-m-3", paperId: "p3", rank: 2 },
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

  // 方向下线 = 连历史 published 期一起隐藏。少了这条断言, 期页会成为下线方向唯一
  // 还能 200 打开、还留在 sitemap / llms.txt 里的入口, 而它页脚的「返回方向页」是 404。
  it("hides published issues of an inactive direction", async () => {
    await expect(
      caller.getIssue({ slug: "retired", issueNumber: 1 }),
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
    expect(dirs.map((d) => d.slug)).toEqual([
      "ai4formath",
      "no-issues-yet",
      "en-only-intro",
      "many-issues",
    ]);
    expect(dirs[0]).toEqual({
      slug: "ai4formath",
      name: "AI4Math ja",
      // createdAt 是后续「先到先得」配色的排序键：必须真被透传, 不是随手漏掉
      createdAt: expect.any(Date),
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
  it("returns a page of issues newest first, each with an excerpt but no content, plus counts", async () => {
    const detail = await caller.getDirection({
      slug: "ai4formath",
      locale: "zh-CN",
    });
    expect(detail?.name).toBe("AI4Math zh-cn");
    expect(detail?.intro).toBe("Intro zh-cn");
    expect(detail?.issues.map((i) => i.issueNumber)).toEqual([2, 1]);
    expect(detail?.issues[0]?.excerpt).toBe("本期看点：形式化数学 有实质进展");
    // dg-1(issue1) 没挂任何 digest_papers；dg-2(issue2) 挂了 p1/p2/p3, p3 已软删
    expect(detail?.issues.map((i) => i.pickCount)).toEqual([2, 0]);
    // issueCount 是已发布期总数, 不是 issues.length(两者这里恰好都是 2, 但
    // paperCount 会把它们拉开: 跨期去重后只有 2 篇非软删论文)
    expect(detail?.issueCount).toBe(2);
    expect(detail?.paperCount).toBe(2);
    expect(detail?.hasMore).toBe(false);
    // 只下发摘要，不把整期四语 markdown 打给客户端
    expect(Object.keys(detail ?? {}).sort()).toEqual([
      "hasMore",
      "intro",
      "issueCount",
      "issues",
      "name",
      "paperCount",
      "slug",
    ]);
    expect(detail?.issues[0]).not.toHaveProperty("content");
    expect(JSON.stringify(detail)).not.toContain("更多内容");
  });

  // focusBrief 是喂 LLM 的内部中文口味描述：公开端点下发的是四语 intro，
  // 内部原文一个字都不该出现在响应里（存量 NULL intro 的回退除外，见下一条）
  it("serves the requested locale's intro and never the internal focusBrief", async () => {
    const detail = await caller.getDirection({
      slug: "ai4formath",
      locale: "ja",
    });
    expect(detail?.intro).toBe("Intro ja");
    expect(detail).not.toHaveProperty("focusBrief");
    expect(JSON.stringify(detail)).not.toContain("自动定理证明与形式化数学");
  });

  // 迁移过渡期：intro 还没生成的方向不能让「当前关注」开天窗
  it("falls back to the Chinese focusBrief while intro is still NULL", async () => {
    const detail = await caller.getDirection({ slug: "no-issues-yet" });
    expect(detail?.intro).toBe("还没出过期");
    expect(detail?.issueCount).toBe(0);
    expect(detail?.paperCount).toBe(0);
    expect(detail?.hasMore).toBe(false);
    expect(detail?.issues).toEqual([]);
  });

  // 只有英文 intro 时请求日文，走 pickTldr 的英文回退而不是空串
  it("falls back to English when the requested locale's intro is missing", async () => {
    const detail = await caller.getDirection({
      slug: "en-only-intro",
      locale: "ja",
    });
    expect(detail?.intro).toBe("English only intro");
  });

  it("returns null for inactive or unknown directions", async () => {
    await expect(caller.getDirection({ slug: "retired" })).resolves.toBeNull();
    await expect(caller.getDirection({ slug: "nope" })).resolves.toBeNull();
  });

  // dir-many 有 15 期, 超过 TIMELINE_PAGE_SIZE(12): 第一页必须裁到 12 条并报
  // hasMore, before 游标翻页要能拿到剩下的 3 条, 且 issueCount/paperCount 两个
  // 跨页统计量不随游标变化(它们统计的是整个方向, 不是当前页)。
  it("paginates the timeline with a before cursor once a direction exceeds TIMELINE_PAGE_SIZE", async () => {
    const page1 = await caller.getDirection({
      slug: "many-issues",
      locale: "zh-CN",
    });
    expect(page1?.issues).toHaveLength(TIMELINE_PAGE_SIZE);
    expect(page1?.issues.map((i) => i.issueNumber)).toEqual([
      15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4,
    ]);
    expect(page1?.hasMore).toBe(true);
    expect(page1?.issueCount).toBe(15);
    expect(page1?.paperCount).toBe(2); // p1/p2 去重, p3 已软删被排除
    expect(page1?.issues[0]?.excerpt).toBe("M body 15 zh-cn");

    const lastOnPage1 = page1?.issues.at(-1)?.issueNumber;
    expect(lastOnPage1).toBe(4);
    const page2 = await caller.getDirection({
      slug: "many-issues",
      before: lastOnPage1,
      locale: "zh-CN",
    });
    expect(page2?.issues.map((i) => i.issueNumber)).toEqual([3, 2, 1]);
    expect(page2?.hasMore).toBe(false);
    // 与第一页相同的全局统计量, 不受游标影响
    expect(page2?.issueCount).toBe(15);
    expect(page2?.paperCount).toBe(2);
    // issue1: p1+p2; issue2: 只有 p1; issue3: p1+已软删的 p3(排除) => 只算 p1
    expect(page2?.issues.map((i) => i.pickCount)).toEqual([1, 1, 2]);
  });
});

describe("digest.getEdition", () => {
  it("aggregates every active direction's winning digest for the period, locale-mapped, with no content field", async () => {
    const edition = await caller.getEdition({
      period: "2026-08-03",
      locale: "zh-CN",
    });
    expect(edition).not.toBeNull();
    expect(edition?.period).toBe("2026-08-03");
    // dg-2 是 ai4formath 在这组里 issue_number 更大的「获胜」期, dg-1 落选;
    // dir-c(en-only-intro) 也在同一天出刊, 两个方向都该出现, 顺序按 sortOrder
    expect(edition?.sections.map((s) => s.directionSlug)).toEqual([
      "ai4formath",
      "en-only-intro",
    ]);
    // retired 方向 isActive=false, many-issues 的期落在另一组日期, 都不该混进来
    expect(edition?.sections.map((s) => s.directionSlug)).not.toContain(
      "retired",
    );
    // active 方向总数 = ai4formath/no-issues-yet/en-only-intro/many-issues, 不含 retired
    expect(edition?.activeDirectionCount).toBe(4);
    // 这组是全库里日期最晚的一组(dir-many 的期全在更早的 2025-06), 没有更晚一组
    expect(edition?.isLatest).toBe(true);
    expect(edition?.nextPeriod).toBeNull();
    // prevPeriod 要跨方向找最近的更早一组: dir-many 那组 2025-06-08 是唯一候选
    expect(edition?.prevPeriod).toBe("2025-06-08");

    const first = edition?.sections[0];
    expect(first).toMatchObject({
      directionSlug: "ai4formath",
      issueNumber: 2, // 获胜的是 issue2, 不是先插入的 issue1
      title: "Issue 2 zh-cn",
      excerpt: "本期看点：形式化数学 有实质进展",
      pickCount: 2, // p1/p2；rank3 的 p3 已软删被排除
    });
    // content 刻意不下发: 全文里的「更多内容」不该出现在序列化响应的任何地方
    expect("content" in (first ?? {})).toBe(false);
    expect(JSON.stringify(edition)).not.toContain("更多内容");
    expect(first?.picks.map((p) => p.id)).toEqual(["p1", "p2"]);

    const second = edition?.sections[1];
    expect(second).toMatchObject({
      directionSlug: "en-only-intro",
      issueNumber: 1,
      title: "C Issue 1 zh-cn",
      excerpt: "C body zh-cn",
      pickCount: 1,
    });
    // p4 没有默认白板(leftJoin), 与 p1/p2 都有图形成对照
    expect(second?.picks[0]).toMatchObject({
      id: "p4",
      title: "Paper Four",
      recommendationNote: "note p4 zh-cn",
      whiteboardImageR2Key: null,
      rank: 1,
    });
  });

  it("returns null for a period with no published digests instead of throwing", async () => {
    await expect(
      caller.getEdition({ period: "2020-01-01" }),
    ).resolves.toBeNull();
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

describe("excerptByLocale", () => {
  it("excerpts every locale, falling back like pickTldr for missing ones", () => {
    // ja 缺失 → 回退 en(与 mapIssueToLocale 的 pickTldr 顺序同口径)
    expect(
      excerptByLocale({
        en: "# T\n\nEnglish body.",
        "zh-cn": "# 题\n\n简体正文。",
        "zh-tw": "# 題\n\n繁體正文。",
      }),
    ).toEqual({
      en: "English body.",
      "zh-cn": "简体正文。",
      "zh-tw": "繁體正文。",
      ja: "English body.",
    });
    // 正文全缺时四个 key 都是空串, head 那边整组略过 description
    expect(excerptByLocale(null)).toEqual({
      en: "",
      "zh-cn": "",
      "zh-tw": "",
      ja: "",
    });
  });
});
