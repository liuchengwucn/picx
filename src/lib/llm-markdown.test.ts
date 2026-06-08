import { describe, expect, it } from "vitest";
import { buildPaperMarkdown } from "./llm-markdown";

const base = {
  title: "Attention Is All You Need",
  shortId: "abc123",
  summary: "## Overview\n\nThe Transformer relies entirely on attention.",
  tldr: "Introduces the Transformer, a model based solely on attention.",
  sourceType: "arxiv" as const,
  sourceUrl: "https://arxiv.org/abs/1706.03762",
  publishedAt: new Date("2017-06-12T00:00:00.000Z"),
  hasWhiteboard: true,
  siteUrl: "https://picx.dev",
};

describe("buildPaperMarkdown", () => {
  it("renders the title as a top-level heading on the first line", () => {
    const md = buildPaperMarkdown(base);
    expect(md.startsWith("# Attention Is All You Need\n")).toBe(true);
  });

  it("renders the tldr as a blockquote when present", () => {
    const md = buildPaperMarkdown(base);
    expect(md).toContain(
      "> Introduces the Transformer, a model based solely on attention.",
    );
  });

  it("omits the blockquote when tldr is missing", () => {
    const md = buildPaperMarkdown({ ...base, tldr: null });
    expect(md).not.toContain("\n>");
  });

  it("links an arXiv source to its url", () => {
    const md = buildPaperMarkdown(base);
    expect(md).toContain("[arXiv](https://arxiv.org/abs/1706.03762)");
  });

  it("labels an uploaded source as a PDF upload without a link", () => {
    const md = buildPaperMarkdown({
      ...base,
      sourceType: "upload",
      sourceUrl: null,
    });
    expect(md).toContain("Uploaded PDF");
    expect(md).not.toContain("](https://arxiv.org");
  });

  it("formats publishedAt as an ISO date", () => {
    const md = buildPaperMarkdown(base);
    expect(md).toContain("2017-06-12");
  });

  it("includes the canonical page permalink", () => {
    const md = buildPaperMarkdown(base);
    expect(md).toContain("https://picx.dev/p/abc123");
  });

  it("includes the whiteboard image url when a whiteboard exists", () => {
    const md = buildPaperMarkdown(base);
    expect(md).toContain("https://picx.dev/p/abc123/image");
  });

  it("omits the whiteboard image url when there is no whiteboard", () => {
    const md = buildPaperMarkdown({ ...base, hasWhiteboard: false });
    expect(md).not.toContain("/p/abc123/image");
  });

  it("places the full summary under a Summary section", () => {
    const md = buildPaperMarkdown(base);
    const summaryIndex = md.indexOf("## Summary");
    expect(summaryIndex).toBeGreaterThan(-1);
    expect(
      md.indexOf("The Transformer relies entirely on attention."),
    ).toBeGreaterThan(summaryIndex);
  });

  it("notes the source page so crawlers know the markdown's origin", () => {
    const md = buildPaperMarkdown(base);
    expect(md.toLowerCase()).toContain("picx");
  });
});
