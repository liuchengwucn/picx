import { describe, expect, it } from "vitest";
import {
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
