// 纯函数 canonicalizeCandidate 的新鲜度硬裁定与 kind 定性测试
import { describe, expect, it } from "vitest";
import { canonicalizeCandidate, MAX_PAPER_AGE_MONTHS } from "./store";
import type { CandidateItem } from "./types";

function makeItem(
  canonicalUrl: string,
  kind: "paper" | "intel",
): CandidateItem {
  return {
    canonicalUrl,
    title: "Some Title",
    kind,
    sourceLabel: "test-angle",
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

  it(`keeps papers exactly ${MAX_PAPER_AGE_MONTHS} months old`, () => {
    const out = canonicalizeCandidate(
      makeItem("https://arxiv.org/abs/2602.00001", "paper"),
      periodEnd,
    );
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("paper");
  });

  it("drops papers older than the age limit", () => {
    const out = canonicalizeCandidate(
      makeItem("https://arxiv.org/abs/2601.00001", "paper"),
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

  it("demotes non-arXiv URLs to intel without age gating", () => {
    const out = canonicalizeCandidate(
      makeItem("https://openreview.net/forum?id=abc", "paper"),
      periodEnd,
    );
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("intel");
    expect(out?.canonicalUrl).toBe("https://openreview.net/forum?id=abc");
  });
});
