import { describe, expect, it } from "vitest";
import {
  mergeRelated,
  type RelatedPaper,
  shuffleArray,
} from "./related-papers";

const p = (shortId: string): RelatedPaper => ({
  shortId,
  title: `Title ${shortId}`,
  publishedAt: null,
  tldr: null,
});

describe("shuffleArray", () => {
  it("returns an array with the same elements", () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffleArray(input);
    expect(result).toHaveLength(input.length);
    expect(result.sort()).toEqual(input.sort());
  });

  it("does not mutate the original", () => {
    const input = [1, 2, 3];
    shuffleArray(input);
    expect(input).toEqual([1, 2, 3]);
  });

  it("handles empty array", () => {
    expect(shuffleArray([])).toEqual([]);
  });
});

describe("mergeRelated", () => {
  it("picks from primary before fallback", () => {
    const out = mergeRelated([p("a"), p("b")], [p("c"), p("d")], 3);
    expect(out).toHaveLength(3);
    // a and b must be present (primary), one of c/d fills the third slot
    const ids = out.map((r) => r.shortId);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids.some((id) => id === "c" || id === "d")).toBe(true);
  });

  it("dedupes shortIds across primary and fallback", () => {
    const out = mergeRelated([p("a")], [p("a"), p("b")], 3);
    const ids = out.map((r) => r.shortId);
    expect(ids.filter((id) => id === "a")).toHaveLength(1);
    expect(ids).toContain("b");
  });

  it("respects the limit", () => {
    const out = mergeRelated([p("a"), p("b"), p("c"), p("d")], [], 2);
    expect(out).toHaveLength(2);
  });

  it("returns empty when there are no candidates", () => {
    expect(mergeRelated([], [], 3)).toEqual([]);
  });

  it("skips entries with empty shortId", () => {
    const out = mergeRelated([{ ...p("a"), shortId: "" }], [p("b")], 3);
    expect(out.map((r) => r.shortId)).toEqual(["b"]);
  });

  it("all results come from primary+fallback pool", () => {
    const primary = [p("a"), p("b"), p("c")];
    const fallback = [p("d"), p("e"), p("f")];
    const out = mergeRelated(primary, fallback, 4);
    const pool = new Set(["a", "b", "c", "d", "e", "f"]);
    for (const r of out) {
      expect(pool.has(r.shortId)).toBe(true);
    }
    expect(out).toHaveLength(4);
  });
});
