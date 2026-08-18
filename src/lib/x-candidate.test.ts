import { describe, expect, it } from "vitest";
import {
  arxivAgeMonths,
  capCandidates,
  MAX_PER_DAY,
  selectDigestCandidates,
} from "./x-candidate";

const mk = (id: string, upvotes: number) => ({ id, upvotes });

describe("capCandidates", () => {
  it("daily cap is 1 (one tweet per day)", () => {
    expect(MAX_PER_DAY).toBe(1);
  });

  it("keeps only the single highest-upvotes row", () => {
    const rows = Array.from({ length: 20 }, (_, i) => mk(`p${i}`, i));
    const out = capCandidates(rows);
    expect(out).toHaveLength(1);
    expect(out[0].upvotes).toBe(19);
  });

  it("returns empty for empty input", () => {
    expect(capCandidates([])).toHaveLength(0);
  });
});

describe("selectDigestCandidates", () => {
  const row = (paperId: string, rank: number, ms: number) => ({
    paperId,
    rank,
    digestPublishedAtMs: ms,
  });

  it("orders by rank asc, then digest publishedAt desc, then paperId asc", () => {
    const out = selectDigestCandidates([
      row("c", 2, 100),
      row("b", 1, 100),
      row("d", 1, 200),
      row("a", 2, 100),
    ]);
    expect(out.map((r) => r.paperId)).toEqual(["d", "b", "a", "c"]);
  });

  it("keeps the min-rank row for a paper picked by multiple digests", () => {
    const out = selectDigestCandidates([
      row("a", 3, 200),
      row("a", 1, 100),
      row("a", 2, 300),
    ]);
    expect(out).toEqual([row("a", 1, 100)]);
  });

  it("breaks rank ties by newer digest publishedAt", () => {
    const out = selectDigestCandidates([row("a", 1, 100), row("a", 1, 300)]);
    expect(out).toEqual([row("a", 1, 300)]);
  });

  it("returns empty for empty input", () => {
    expect(selectDigestCandidates([])).toEqual([]);
  });

  it("dedups then orders across mixed papers and issues", () => {
    // worker 实际输入形状：多论文 × 多期（跨方向重复入选）混在一起。
    const out = selectDigestCandidates([
      row("a", 3, 100), // a 同时入选两期：rank 3 应被 rank 1 行淘汰
      row("b", 1, 200),
      row("a", 1, 100),
      row("c", 2, 300),
      row("b", 1, 100), // b 的旧刊行：同 rank 应被新刊行淘汰
    ]);
    expect(out).toEqual([row("b", 1, 200), row("a", 1, 100), row("c", 2, 300)]);
  });

  it("preserves extra fields on rows", () => {
    const out = selectDigestCandidates([
      { ...row("a", 1, 100), note: "why it matters" },
    ]);
    expect(out[0].note).toBe("why it matters");
  });
});

describe("arxivAgeMonths", () => {
  const at = new Date("2026-08-08T00:00:00Z");

  it("computes month age for a fresh arXiv paper", () => {
    expect(arxivAgeMonths("https://arxiv.org/abs/2606.29493", at)).toBe(2);
  });

  it("returns 0 for a paper published this month", () => {
    expect(arxivAgeMonths("https://arxiv.org/abs/2608.00001", at)).toBe(0);
  });

  it("returns a large age for a stale paper", () => {
    expect(arxivAgeMonths("https://arxiv.org/abs/2401.00001", at)).toBe(31);
  });

  it("returns null for a non-arXiv URL", () => {
    expect(arxivAgeMonths("https://example.com/blog/post", at)).toBeNull();
  });

  it("returns null for a pseudo arXiv URL with an invalid month (13)", () => {
    expect(arxivAgeMonths("https://arxiv.org/abs/2613.00001", at)).toBeNull();
  });
});
