import { describe, expect, it } from "vitest";
import { prefersMarkdown } from "./content-negotiation";

describe("prefersMarkdown", () => {
  it("is false when there is no Accept header", () => {
    expect(prefersMarkdown(null)).toBe(false);
  });

  it("is false for a typical browser Accept header", () => {
    // 真实浏览器从不发送 text/markdown, 绝不能被误判。
    expect(
      prefersMarkdown(
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      ),
    ).toBe(false);
  });

  it("is false for a wildcard-only Accept header", () => {
    expect(prefersMarkdown("*/*")).toBe(false);
  });

  it("is true when only markdown is requested", () => {
    expect(prefersMarkdown("text/markdown")).toBe(true);
  });

  it("is true when markdown is listed alongside html at equal quality", () => {
    expect(prefersMarkdown("text/markdown, text/html")).toBe(true);
  });

  it("is true when markdown outranks html by quality", () => {
    expect(prefersMarkdown("text/html;q=0.8, text/markdown;q=0.9")).toBe(true);
  });

  it("is false when html outranks markdown by quality", () => {
    expect(prefersMarkdown("text/html, text/markdown;q=0.1")).toBe(false);
  });
});
