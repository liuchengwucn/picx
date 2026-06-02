import { describe, expect, it } from "vitest";
import { escapeLike, parseCsvParam, parseSort } from "./gallery-search";

describe("escapeLike", () => {
  it("escapes % _ and the escape char itself with backslash", () => {
    expect(escapeLike("a%b_c")).toBe("a\\%b\\_c");
    expect(escapeLike("100\\50")).toBe("100\\\\50");
  });
  it("leaves CJK and normal text untouched", () => {
    expect(escapeLike("多模态 diffusion")).toBe("多模态 diffusion");
  });
});

describe("parseCsvParam", () => {
  it("splits comma list, trims, drops empties", () => {
    expect(parseCsvParam("llm, vision ,, multimodal")).toEqual([
      "llm",
      "vision",
      "multimodal",
    ]);
  });
  it("handles undefined / empty", () => {
    expect(parseCsvParam(undefined)).toEqual([]);
    expect(parseCsvParam("")).toEqual([]);
  });
});

describe("parseSort", () => {
  it("accepts known sorts, defaults to recent", () => {
    expect(parseSort("popular")).toBe("popular");
    expect(parseSort("recent")).toBe("recent");
    expect(parseSort("bogus")).toBe("recent");
    expect(parseSort(undefined)).toBe("recent");
  });
});
