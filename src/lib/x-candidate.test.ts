import { describe, expect, it } from "vitest";
import { capCandidates, MAX_PER_DAY } from "./x-candidate";

const mk = (id: string, upvotes: number) => ({ id, upvotes });

describe("capCandidates", () => {
  it("keeps only the top MAX_PER_DAY by upvotes desc", () => {
    const rows = Array.from({ length: 20 }, (_, i) => mk(`p${i}`, i));
    const out = capCandidates(rows);
    expect(out).toHaveLength(MAX_PER_DAY);
    // 取的是 upvotes 最高的（19,18,...）
    expect(out[0].upvotes).toBe(19);
  });

  it("returns all rows when fewer than the cap", () => {
    const rows = [mk("a", 50), mk("b", 40)];
    expect(capCandidates(rows)).toHaveLength(2);
  });

  it("exposes a sane daily cap", () => {
    expect(MAX_PER_DAY).toBeGreaterThanOrEqual(1);
  });
});
