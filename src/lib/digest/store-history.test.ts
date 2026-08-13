/**
 * loadDirectionContext 的跨期记忆装载：published-only、新期在前 rank 升序、
 * 行数截断、note/正文的 DIGEST_LOCALES 回退链、首期冷启动空值形状。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { digestPapers, digests, directions, papers, user } from "#/db/schema";
import { createTestDb } from "../../../test/helpers/sqlite-d1";
import {
  loadDirectionContext,
  PAST_PICKS_ISSUES,
  PAST_PICKS_MAX_ROWS,
} from "./store";

type Db = ReturnType<typeof createTestDb>["db"];

const PERIOD_START = new Date("2026-07-27T00:00:00Z");
const PERIOD_END = new Date("2026-08-03T00:00:00Z");

function four(prefix: string): Record<string, string> {
  return {
    "zh-cn": `${prefix} zh-cn`,
    "zh-tw": `${prefix} zh-tw`,
    en: `${prefix} en`,
    ja: `${prefix} ja`,
  };
}

let db: Db;

beforeEach(async () => {
  db = createTestDb().db;
  const now = new Date();
  await db.insert(user).values({
    id: "u1",
    name: "A",
    email: "u1@example.com",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(directions).values({
    id: "dir-1",
    slug: "d1",
    name: four("D1"),
    focusBrief: "brief",
    isActive: true,
    sortOrder: 0,
  });
});

async function seedIssue(input: {
  issueNumber: number;
  status: "published" | "generating" | "failed";
  /** 缺省 "dir-1"；跨方向隔离测试需要落在别的方向 */
  directionId?: string;
  /** 缺省 `dg-${directionId}-${issueNumber}`，跨方向共用 issueNumber 时须显式传以避免撞主键 */
  digestId?: string;
  /** 缺省 four(`Body N`)；显式传 null 表示无正文 */
  content?: Record<string, string> | null;
  picks?: Array<{
    paperId: string;
    rank: number;
    note: Record<string, string> | null;
  }>;
}) {
  const directionId = input.directionId ?? "dir-1";
  const digestId = input.digestId ?? `dg-${directionId}-${input.issueNumber}`;
  await db.insert(digests).values({
    id: digestId,
    directionId,
    issueNumber: input.issueNumber,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    status: input.status,
    content:
      input.content === undefined
        ? four(`Body ${input.issueNumber}`)
        : input.content,
    workflowInstanceId: `wf-${digestId}`,
  });
  for (const pick of input.picks ?? []) {
    await db.insert(papers).values({
      id: pick.paperId,
      shortId: `sid-${pick.paperId}`,
      userId: "u1",
      title: `Paper ${pick.paperId}`,
      sourceType: "arxiv",
      pdfR2Key: `papers/${pick.paperId}.pdf`,
      fileSize: 1,
      status: "completed",
      isPublic: true,
      isListedInGallery: true,
      directionId,
    });
    await db.insert(digestPapers).values({
      digestId,
      paperId: pick.paperId,
      rank: pick.rank,
      recommendationNote: pick.note,
    });
  }
}

describe("loadDirectionContext history", () => {
  it("returns empty history when the direction has no published issue", async () => {
    await seedIssue({ issueNumber: 1, status: "generating", content: null });
    const ctx = await loadDirectionContext(db, "dir-1");
    expect(ctx.history.pastPicks).toEqual([]);
    expect(ctx.history.lastIssueBody).toBeNull();
    expect(ctx.history.lastIssueNumber).toBeNull();
  });

  it("collects picks newest-issue-first, rank ascending, published-only, with locale fallback", async () => {
    await seedIssue({
      issueNumber: 1,
      status: "published",
      picks: [
        { paperId: "p1a", rank: 1, note: four("N1a") },
        { paperId: "p1b", rank: 2, note: { en: "only english" } },
      ],
    });
    await seedIssue({
      issueNumber: 2,
      status: "published",
      picks: [
        // 故意先插 rank 2 再插 rank 1：锁住 asc(rank) 排序
        { paperId: "p2b", rank: 2, note: null },
        { paperId: "p2a", rank: 1, note: four("N2a") },
      ],
    });
    // 非 published 期的 picks 不得进清单，其正文也不得当「上一期」
    await seedIssue({
      issueNumber: 3,
      status: "failed",
      picks: [{ paperId: "p3a", rank: 1, note: four("N3a") }],
    });
    const ctx = await loadDirectionContext(db, "dir-1");
    expect(ctx.history.pastPicks).toEqual([
      { issueNumber: 2, title: "Paper p2a", note: "N2a zh-cn" },
      { issueNumber: 2, title: "Paper p2b", note: "" },
      { issueNumber: 1, title: "Paper p1a", note: "N1a zh-cn" },
      { issueNumber: 1, title: "Paper p1b", note: "only english" },
    ]);
    expect(ctx.history.lastIssueBody).toBe("Body 2 zh-cn");
    expect(ctx.history.lastIssueNumber).toBe(2);
  });

  it(`only includes the newest ${PAST_PICKS_ISSUES} published issues`, async () => {
    for (let i = 1; i <= PAST_PICKS_ISSUES + 2; i++) {
      await seedIssue({
        issueNumber: i,
        status: "published",
        picks: [{ paperId: `p${i}`, rank: 1, note: four(`N${i}`) }],
      });
    }
    const ctx = await loadDirectionContext(db, "dir-1");
    expect(ctx.history.pastPicks).toHaveLength(PAST_PICKS_ISSUES);
    const issueNumbers = ctx.history.pastPicks.map((p) => p.issueNumber);
    expect(issueNumbers[0]).toBe(PAST_PICKS_ISSUES + 2);
    expect(Math.min(...issueNumbers)).toBe(3); // 期 1、2 被挤出
  });

  it(`caps the list at ${PAST_PICKS_MAX_ROWS} rows, dropping the oldest issue's tail`, async () => {
    // 8 期 × 11 picks = 88 行 > 80
    for (let i = 1; i <= PAST_PICKS_ISSUES; i++) {
      await seedIssue({
        issueNumber: i,
        status: "published",
        picks: Array.from({ length: 11 }, (_, k) => ({
          paperId: `p${i}-${k}`,
          rank: k + 1,
          note: null,
        })),
      });
    }
    const ctx = await loadDirectionContext(db, "dir-1");
    expect(ctx.history.pastPicks).toHaveLength(PAST_PICKS_MAX_ROWS);
    // 截掉的是最旧期（#1）的尾部：只剩 80 - 7×11 = 3 行
    const oldest = ctx.history.pastPicks.filter((p) => p.issueNumber === 1);
    expect(oldest).toHaveLength(PAST_PICKS_MAX_ROWS - 7 * 11);
  });

  it("treats an all-empty last-issue body as absent (both fields null) while picks remain", async () => {
    await seedIssue({
      issueNumber: 1,
      status: "published",
      content: { "zh-cn": "  ", en: "" },
      picks: [{ paperId: "p1", rank: 1, note: four("N1") }],
    });
    const ctx = await loadDirectionContext(db, "dir-1");
    expect(ctx.history.pastPicks).toHaveLength(1);
    expect(ctx.history.lastIssueBody).toBeNull();
    expect(ctx.history.lastIssueNumber).toBeNull();
  });

  it("falls back through DIGEST_LOCALES order for the last-issue body", async () => {
    // zh-cn 空、zh-tw 缺 → en 先于 ja 命中
    await seedIssue({
      issueNumber: 1,
      status: "published",
      content: { "zh-cn": "", ja: "ja body", en: "en body" },
    });
    const ctx = await loadDirectionContext(db, "dir-1");
    expect(ctx.history.lastIssueBody).toBe("en body");
    expect(ctx.history.lastIssueNumber).toBe(1);
  });

  it("does not leak another direction's picks or last-issue body", async () => {
    await db.insert(directions).values({
      id: "dir-2",
      slug: "d2",
      name: four("D2"),
      focusBrief: "brief 2",
      isActive: true,
      sortOrder: 1,
    });
    await seedIssue({
      issueNumber: 1,
      status: "published",
      picks: [{ paperId: "p1-dir1", rank: 1, note: four("N1-dir1") }],
    });
    await seedIssue({
      issueNumber: 1,
      status: "published",
      directionId: "dir-2",
      content: four("Body dir2"),
      picks: [{ paperId: "p1-dir2", rank: 1, note: four("N1-dir2") }],
    });
    const ctx = await loadDirectionContext(db, "dir-1");
    expect(ctx.history.pastPicks).toEqual([
      { issueNumber: 1, title: "Paper p1-dir1", note: "N1-dir1 zh-cn" },
    ]);
    expect(ctx.history.lastIssueBody).toBe("Body 1 zh-cn");
    expect(ctx.history.lastIssueNumber).toBe(1);
  });
});
