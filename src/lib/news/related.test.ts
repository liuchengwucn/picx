import { describe, expect, it } from "vitest";
import {
  mergeRelated,
  pickRelated,
  RELATED_MAX,
  RELATED_MIN_SIM,
  type RelatedCandidate,
} from "./related";

const unit = (i: number) => {
  const v = new Float32Array(4);
  v[i] = 1;
  return v;
};

describe("pickRelated", () => {
  it("filters by threshold, excludes self, caps at RELATED_MAX", () => {
    const self: RelatedCandidate = {
      id: "self",
      shortId: "S",
      centroid: unit(0),
    };
    const same = (id: string): RelatedCandidate => ({
      id,
      shortId: id,
      centroid: unit(0),
    });
    // identical direction -> sim = 1 (>= threshold, included)
    // orthogonal direction -> sim = 0 (< threshold, excluded)
    const ortho: RelatedCandidate = {
      id: "o",
      shortId: "o",
      centroid: unit(1),
    };
    const picked = pickRelated(self.id, self.centroid, [
      self,
      same("a"),
      same("b"),
      same("c"),
      same("d"),
      same("e"),
      ortho,
    ]);
    expect(picked).toHaveLength(RELATED_MAX);
    expect(picked).not.toContain("S");
    expect(picked).not.toContain("o");
  });

  it("returns empty when no candidate clears the threshold", () => {
    expect(
      pickRelated("self", unit(0), [
        { id: "o", shortId: "o", centroid: unit(1) },
      ]),
    ).toEqual([]);
  });

  it("includes a candidate exactly at the RELATED_MIN_SIM boundary (>=, not >)", () => {
    // Two 2D unit vectors at angle theta with cos(theta) == RELATED_MIN_SIM exactly:
    // a = (1, 0), b = (RELATED_MIN_SIM, sqrt(1 - RELATED_MIN_SIM^2))
    const a = new Float32Array([1, 0]);
    const sinTheta = Math.sqrt(1 - RELATED_MIN_SIM * RELATED_MIN_SIM);
    const b = new Float32Array([RELATED_MIN_SIM, sinTheta]);
    const picked = pickRelated("self", a, [
      { id: "b", shortId: "b", centroid: b },
    ]);
    expect(picked).toEqual(["b"]);
  });
});

describe("mergeRelated", () => {
  it("prepends, dedupes, truncates, and is idempotent", () => {
    expect(mergeRelated(["a", "b"], "n")).toEqual(["n", "a", "b"]);
    expect(mergeRelated(["n", "a"], "n")).toEqual(["n", "a"]);
    expect(mergeRelated(["a", "b", "c", "d"], "n")).toEqual([
      "n",
      "a",
      "b",
      "c",
    ]);
    const once = mergeRelated(["a", "b", "c", "d"], "n");
    expect(mergeRelated(once, "n")).toEqual(once);
    expect(mergeRelated(null, "n")).toEqual(["n"]);
    expect(mergeRelated(undefined, "n")).toEqual(["n"]);
  });
});
