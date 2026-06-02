import { describe, expect, it } from "vitest";
import {
  isValidCategorySlug,
  normalizeCategorySlugs,
  PAPER_CATEGORY_SLUGS,
} from "./paper-categories";

describe("PAPER_CATEGORY_SLUGS", () => {
  it("contains 17 slugs including 'other'", () => {
    expect(PAPER_CATEGORY_SLUGS).toHaveLength(17);
    expect(PAPER_CATEGORY_SLUGS).toContain("other");
    expect(PAPER_CATEGORY_SLUGS).toContain("llm");
    expect(PAPER_CATEGORY_SLUGS).toContain("multimodal");
  });

  it("has no duplicates", () => {
    expect(new Set(PAPER_CATEGORY_SLUGS).size).toBe(
      PAPER_CATEGORY_SLUGS.length,
    );
  });
});

describe("isValidCategorySlug", () => {
  it("accepts known slugs, rejects unknown", () => {
    expect(isValidCategorySlug("llm")).toBe(true);
    expect(isValidCategorySlug("not-a-category")).toBe(false);
  });
});

describe("normalizeCategorySlugs", () => {
  it("keeps only valid slugs, dedupes, drops junk", () => {
    expect(normalizeCategorySlugs(["llm", "llm", "bogus", "vision"])).toEqual([
      "llm",
      "vision",
    ]);
  });
  it("returns [] for empty/garbage", () => {
    expect(normalizeCategorySlugs([])).toEqual([]);
    expect(normalizeCategorySlugs(["", "x"])).toEqual([]);
  });
});
