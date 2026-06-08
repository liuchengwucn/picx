import { describe, expect, it } from "vitest";
import { buildLlmsFullTxt, buildLlmsTxt } from "./llms-txt";

const siteUrl = "https://picx.dev";

const papers = [
  {
    title: "Attention Is All You Need",
    shortId: "abc123",
    tldr: "Introduces the Transformer.",
    summary: "## Overview\n\nThe Transformer relies entirely on attention.",
    sourceType: "arxiv" as const,
    sourceUrl: "https://arxiv.org/abs/1706.03762",
    publishedAt: new Date("2017-06-12T00:00:00.000Z"),
    hasWhiteboard: true,
  },
  {
    title: "Deep Residual Learning",
    shortId: "def456",
    tldr: null,
    summary: "Residual connections ease optimization of deep networks.",
    sourceType: "arxiv" as const,
    sourceUrl: "https://arxiv.org/abs/1512.03385",
    publishedAt: new Date("2015-12-10T00:00:00.000Z"),
    hasWhiteboard: false,
  },
];

describe("buildLlmsTxt", () => {
  it("starts with the PicX H1 header", () => {
    const txt = buildLlmsTxt({ siteUrl, papers });
    expect(txt.startsWith("# PicX\n")).toBe(true);
  });

  it("includes a one-line description blockquote", () => {
    const txt = buildLlmsTxt({ siteUrl, papers });
    expect(txt).toMatch(/\n> .+/);
  });

  it("links each paper to its markdown view", () => {
    const txt = buildLlmsTxt({ siteUrl, papers });
    expect(txt).toContain(
      "[Attention Is All You Need](https://picx.dev/p/abc123.md)",
    );
    expect(txt).toContain(
      "[Deep Residual Learning](https://picx.dev/p/def456.md)",
    );
  });

  it("appends the tldr as a note when present", () => {
    const txt = buildLlmsTxt({ siteUrl, papers });
    expect(txt).toContain(
      "[Attention Is All You Need](https://picx.dev/p/abc123.md): Introduces the Transformer.",
    );
  });

  it("omits the note separator when a paper has no tldr", () => {
    const txt = buildLlmsTxt({ siteUrl, papers });
    expect(txt).toContain(
      "[Deep Residual Learning](https://picx.dev/p/def456.md)\n",
    );
    expect(txt).not.toContain("def456.md): ");
  });

  it("links the gallery and about pages", () => {
    const txt = buildLlmsTxt({ siteUrl, papers });
    expect(txt).toContain("(https://picx.dev/gallery)");
    expect(txt).toContain("(https://picx.dev/about)");
  });
});

describe("buildLlmsFullTxt", () => {
  it("starts with the PicX H1 header", () => {
    const txt = buildLlmsFullTxt({ siteUrl, papers, maxBytes: 100_000 });
    expect(txt.startsWith("# PicX\n")).toBe(true);
  });

  it("inlines the full summary of each paper", () => {
    const txt = buildLlmsFullTxt({ siteUrl, papers, maxBytes: 100_000 });
    expect(txt).toContain("The Transformer relies entirely on attention.");
    expect(txt).toContain(
      "Residual connections ease optimization of deep networks.",
    );
  });

  it("stays within the byte budget by dropping overflow papers", () => {
    // Budget fits the header + first paper (~656B) but not the second (~841B).
    const txt = buildLlmsFullTxt({ siteUrl, papers, maxBytes: 700 });
    const bytes = new TextEncoder().encode(txt).length;
    expect(bytes).toBeLessThanOrEqual(700);
    // The second paper must not fully fit in such a small budget.
    expect(txt).not.toContain(
      "Residual connections ease optimization of deep networks.",
    );
  });

  it("notes when papers were omitted for size", () => {
    const txt = buildLlmsFullTxt({ siteUrl, papers, maxBytes: 700 });
    expect(txt.toLowerCase()).toContain("omitted");
  });
});
