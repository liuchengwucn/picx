// 纯函数 canonicalizeCandidate 的新鲜度硬裁定与 kind 定性测试；
// updateCandidateStatus 的 source_meta 合并跑真 SQLite（读-改-写的语义 mock 不出来）
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { directionCandidates, directions } from "#/db/schema";
import { createTestDb } from "../../../test/helpers/sqlite-d1";
import {
  canonicalizeCandidate,
  MAX_CANDIDATE_AGE_MONTHS,
  updateCandidateStatus,
  upsertCandidatesSeen,
} from "./store";
import type { CandidateItem } from "./types";

function makeItem(
  canonicalUrl: string,
  kind: "paper" | "intel",
  publishedAt?: string,
): CandidateItem {
  return {
    canonicalUrl,
    title: "Some Title",
    kind,
    sourceLabel: "test-angle",
    publishedAt,
  };
}

describe("canonicalizeCandidate", () => {
  const periodEnd = new Date("2026-08-08");

  it("keeps fresh arXiv papers, canonicalizing URL and kind", () => {
    const out = canonicalizeCandidate(
      makeItem("https://arxiv.org/abs/2606.29493", "intel"),
      periodEnd,
    );
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("paper");
    expect(out?.canonicalUrl).toBe("https://arxiv.org/abs/2606.29493");
  });

  it(`keeps papers exactly ${MAX_CANDIDATE_AGE_MONTHS} months old`, () => {
    // periodEnd 2026-08，阈值 3 个月 → 2605 恰好 3 个月，保留
    const out = canonicalizeCandidate(
      makeItem("https://arxiv.org/abs/2605.00001", "paper"),
      periodEnd,
    );
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("paper");
  });

  it("drops papers older than the age limit", () => {
    // 2604 距 2026-08 已 4 个月 > 3
    const out = canonicalizeCandidate(
      makeItem("https://arxiv.org/abs/2604.00001", "paper"),
      periodEnd,
    );
    expect(out).toBeNull();
  });

  it("drops old-style arXiv IDs entirely", () => {
    const out = canonicalizeCandidate(
      makeItem("https://arxiv.org/abs/math/0601001", "paper"),
      periodEnd,
    );
    expect(out).toBeNull();
  });

  it("drops pseudo arXiv IDs with an invalid month (unanchored regex false match)", () => {
    // canonicalArxivId 的未锚定正则会从这个 URL 里"找到" 2699.12345；
    // 月份 99 非法，无月份守卫时 monthsDiff 为负会误判为新鲜论文
    const out = canonicalizeCandidate(
      makeItem("https://example.com/2699.12345/page", "paper"),
      periodEnd,
    );
    expect(out).toBeNull();
  });

  it("flags undated non-arXiv URLs for date resolution", () => {
    const out = canonicalizeCandidate(
      makeItem("https://openreview.net/forum?id=abc", "paper"),
      periodEnd,
    );
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("intel");
    expect(out?.dateUnknown).toBe(true);
    expect(out?.canonicalUrl).toBe("https://openreview.net/forum?id=abc");
  });

  it("drops stale aclanthology intel by URL-encoded venue date", () => {
    // EMNLP 2025 ≈ 2025-11，距 2026-08 已 9 个月（生产实证场景：issue 1 的漏网条目）
    const out = canonicalizeCandidate(
      makeItem("https://aclanthology.org/2025.emnlp-main.544/", "intel"),
      periodEnd,
    );
    expect(out).toBeNull();
  });

  it("keeps recent aclanthology intel", () => {
    // ACL 2026 ≈ 2026-07，1 个月龄
    const out = canonicalizeCandidate(
      makeItem("https://aclanthology.org/2026.acl-long.100/", "paper"),
      periodEnd,
    );
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("intel");
  });

  it("matches the main venue inside compound findings collections", () => {
    // findings-eacl 命中 eacl（≈2026-03），5 个月龄 > 3；且不得被 acl(7月) 抢先匹配
    const out = canonicalizeCandidate(
      makeItem("https://aclanthology.org/2026.findings-eacl.213/", "intel"),
      periodEnd,
    );
    expect(out).toBeNull();
  });

  it("fails open on unknown aclanthology venues within the current year", () => {
    // 未知 workshop → 月份取 12，当年条目放行
    const out = canonicalizeCandidate(
      makeItem("https://aclanthology.org/2026.naloma-1.5/", "intel"),
      periodEnd,
    );
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("intel");
  });

  it("drops unknown aclanthology venues from clearly stale years", () => {
    // 2024 年即便按 12 月算也超龄
    const out = canonicalizeCandidate(
      makeItem("https://aclanthology.org/2024.someworkshop-1.2/", "intel"),
      periodEnd,
    );
    expect(out).toBeNull();
  });

  it("prefers the URL-encoded date over the model-claimed publishedAt", () => {
    // URL 是权威事实，LLM 自述新日期不能洗白
    const out = canonicalizeCandidate(
      makeItem(
        "https://aclanthology.org/2025.emnlp-main.544/",
        "intel",
        "2026-08-01",
      ),
      periodEnd,
    );
    expect(out).toBeNull();
  });

  it("drops intel with a stale model-claimed publishedAt", () => {
    const out = canonicalizeCandidate(
      makeItem("https://example.com/blog/post", "intel", "2026-01-10"),
      periodEnd,
    );
    expect(out).toBeNull();
  });

  it("keeps intel with a recent publishedAt", () => {
    const out = canonicalizeCandidate(
      makeItem("https://example.com/blog/post", "intel", "2026-07-20"),
      periodEnd,
    );
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("intel");
  });

  it("flags unparseable publishedAt for date resolution", () => {
    const out = canonicalizeCandidate(
      makeItem("https://example.com/blog/post", "intel", "unknown"),
      periodEnd,
    );
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("intel");
    expect(out?.dateUnknown).toBe(true);
  });

  it("re-gates a flagged item once publishedAt is resolved fresh", () => {
    const out = canonicalizeCandidate(
      {
        ...makeItem("https://example.com/blog/post", "intel", "2026-07-01"),
        dateUnknown: true,
      },
      periodEnd,
    );
    expect(out).not.toBeNull();
    expect(out?.dateUnknown).toBeFalsy();
  });

  it("drops a flagged item once publishedAt is resolved stale", () => {
    const out = canonicalizeCandidate(
      {
        ...makeItem("https://example.com/blog/post", "intel", "2025-10-01"),
        dateUnknown: true,
      },
      periodEnd,
    );
    expect(out).toBeNull();
  });
});

describe("updateCandidateStatus source_meta merge", () => {
  const URL = "https://arxiv.org/abs/2608.00042";

  async function seedCandidate() {
    const { db } = createTestDb();
    await db.insert(directions).values({
      id: "dir-1",
      slug: "coding-agent",
      name: { en: "Agents", "zh-cn": "智能体", "zh-tw": "智能體", ja: "AI" },
      focusBrief: "硬标准：单一饱和基准且无 held-out 的按 filler 处理",
      isActive: true,
      sortOrder: 0,
    });
    await upsertCandidatesSeen(db, "dir-1", [
      {
        canonicalUrl: URL,
        title: "Agent Lightning",
        kind: "paper",
        sourceLabel: "arxiv-cs-ai",
        publishedAt: "2026-08-20",
      },
    ]);
    return db;
  }

  const read = async (db: Awaited<ReturnType<typeof seedCandidate>>) => {
    const [row] = await db
      .select()
      .from(directionCandidates)
      .where(
        and(
          eq(directionCandidates.directionId, "dir-1"),
          eq(directionCandidates.canonicalUrl, URL),
        ),
      );
    return row;
  };

  const verdict = {
    hardRule: {
      violated: true,
      rule: "单一饱和基准且无 held-out",
      reason: "只在 GSM8K 上报增益",
      issue: 4,
      checkedAt: "2026-09-05T12:00:00.000Z",
    },
  };

  it("adds hardRule while keeping the keys upsert wrote (sourceLabel/publishedAt)", async () => {
    const db = await seedCandidate();
    await updateCandidateStatus(db, "dir-1", URL, {
      score: 71,
      sourceMeta: verdict,
    });
    const row = await read(db);
    expect(row.score).toBe(71);
    expect(row.status).toBe("seen");
    expect(row.sourceMeta).toEqual({
      sourceLabel: "arxiv-cs-ai",
      publishedAt: "2026-08-20",
      ...verdict,
    });
  });

  it("is idempotent under step replay and overwrites a stale verdict in place", async () => {
    const db = await seedCandidate();
    await updateCandidateStatus(db, "dir-1", URL, { sourceMeta: verdict });
    await updateCandidateStatus(db, "dir-1", URL, { sourceMeta: verdict });
    expect((await read(db)).sourceMeta).toEqual({
      sourceLabel: "arxiv-cs-ai",
      publishedAt: "2026-08-20",
      ...verdict,
    });
    const next = {
      hardRule: { ...verdict.hardRule, violated: false, rule: "", issue: 5 },
    };
    await updateCandidateStatus(db, "dir-1", URL, { sourceMeta: next });
    expect((await read(db)).sourceMeta).toEqual({
      sourceLabel: "arxiv-cs-ai",
      publishedAt: "2026-08-20",
      ...next,
    });
  });

  it("leaves source_meta untouched when the patch omits it", async () => {
    const db = await seedCandidate();
    await updateCandidateStatus(db, "dir-1", URL, { sourceMeta: verdict });
    await updateCandidateStatus(db, "dir-1", URL, { status: "recommended" });
    const row = await read(db);
    expect(row.status).toBe("recommended");
    expect(row.sourceMeta).toEqual({
      sourceLabel: "arxiv-cs-ai",
      publishedAt: "2026-08-20",
      ...verdict,
    });
  });

  it("does not create a row when the candidate is absent (update-only)", async () => {
    const db = await seedCandidate();
    await updateCandidateStatus(db, "dir-1", "https://example.com/missing", {
      sourceMeta: verdict,
    });
    const rows = await db.select().from(directionCandidates);
    expect(rows).toHaveLength(1);
    expect(rows[0].canonicalUrl).toBe(URL);
  });
});
