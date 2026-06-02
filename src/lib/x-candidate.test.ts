import { describe, expect, it } from "vitest";
import { capCandidates, MAX_PER_DAY } from "./x-candidate";

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
