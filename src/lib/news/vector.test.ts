import { describe, expect, it } from "vitest";
import { cosineSimilarity, mergeCentroid } from "./vector";

describe("cosineSimilarity", () => {
  it("identical vectors → 1", () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });
  it("orthogonal vectors → 0", () => {
    expect(
      cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1])),
    ).toBeCloseTo(0);
  });
  it("zero or mismatched vectors → 0", () => {
    expect(
      cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1])),
    ).toBe(0);
    expect(
      cosineSimilarity(new Float32Array([1]), new Float32Array([1, 2])),
    ).toBe(0);
  });
});

describe("mergeCentroid", () => {
  it("weights by existing count", () => {
    const merged = mergeCentroid(
      new Float32Array([1, 1]),
      3,
      new Float32Array([5, 5]),
    );
    expect(Array.from(merged)).toEqual([2, 2]);
  });
});
