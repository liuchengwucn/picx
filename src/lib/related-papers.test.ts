import { describe, expect, it } from "vitest";
import { mergeRelated, type RelatedPaper } from "./related-papers";

const p = (shortId: string): RelatedPaper => ({
  shortId,
  title: `Title ${shortId}`,
  publishedAt: null,
  tldr: null,
});

describe("mergeRelated", () => {
  it("keeps category matches first, fills from fallback", () => {
    const out = mergeRelated([p("a"), p("b")], [p("c"), p("d")], 3);
    expect(out.map((r) => r.shortId)).toEqual(["a", "b", "c"]);
  });

  it("dedupes shortIds across primary and fallback", () => {
    const out = mergeRelated([p("a")], [p("a"), p("b")], 3);
    expect(out.map((r) => r.shortId)).toEqual(["a", "b"]);
  });

  it("respects the limit", () => {
    const out = mergeRelated([p("a"), p("b"), p("c"), p("d")], [], 2);
    expect(out.map((r) => r.shortId)).toEqual(["a", "b"]);
  });

  it("returns empty when there are no candidates", () => {
    expect(mergeRelated([], [], 3)).toEqual([]);
  });

  it("skips entries with empty shortId", () => {
    const out = mergeRelated([{ ...p("a"), shortId: "" }], [p("b")], 3);
    expect(out.map((r) => r.shortId)).toEqual(["b"]);
  });
});
