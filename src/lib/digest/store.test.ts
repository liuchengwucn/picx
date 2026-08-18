// 纯函数 canonicalizeCandidate 的新鲜度硬裁定与 kind 定性测试
import { describe, expect, it } from "vitest";
import { canonicalizeCandidate, MAX_CANDIDATE_AGE_MONTHS } from "./store";
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

  it("demotes undated non-arXiv URLs to intel (fail-open)", () => {
    const out = canonicalizeCandidate(
      makeItem("https://openreview.net/forum?id=abc", "paper"),
      periodEnd,
    );
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("intel");
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

  it("fails open on unparseable publishedAt", () => {
    const out = canonicalizeCandidate(
      makeItem("https://example.com/blog/post", "intel", "unknown"),
      periodEnd,
    );
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("intel");
  });
});
