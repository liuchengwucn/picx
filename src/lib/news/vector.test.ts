import { describe, expect, it } from "vitest";
import { cosineSimilarity, meanVector, mergeCentroid } from "./vector";

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
  it("throws on dimension mismatch", () => {
    expect(() =>
      mergeCentroid(new Float32Array([1, 1]), 1, new Float32Array([1])),
    ).toThrow(/dimension mismatch/);
  });
});

describe("meanVector", () => {
  it("averages all members", () => {
    const mean = meanVector([
      new Float32Array([0, 10]),
      new Float32Array([2, 20]),
      new Float32Array([4, 30]),
    ]);
    expect(Array.from(mean)).toEqual([2, 20]);
  });
  it("single vector → itself", () => {
    expect(Array.from(meanVector([new Float32Array([3, -1])]))).toEqual([
      3, -1,
    ]);
  });
  it("self-heals a double-merged centroid", () => {
    // 重复并入：a 被算了两次，增量 centroid 偏向 a；全量重算应回到真实均值
    const a = new Float32Array([0, 0]);
    const b = new Float32Array([4, 4]);
    const skewed = mergeCentroid(mergeCentroid(a, 1, a), 2, b);
    expect(Array.from(skewed)).not.toEqual([2, 2]);
    expect(Array.from(meanVector([a, b]))).toEqual([2, 2]);
  });
  it("throws on empty input", () => {
    expect(() => meanVector([])).toThrow(/empty input/);
  });
  it("throws on dimension mismatch", () => {
    expect(() =>
      meanVector([new Float32Array([1, 1]), new Float32Array([1])]),
    ).toThrow(/dimension mismatch/);
  });
});
