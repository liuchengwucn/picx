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

  it("always links the news page, regardless of stories", () => {
    const txt = buildLlmsTxt({ siteUrl, papers });
    expect(txt).toContain("(https://picx.dev/news)");
  });

  it("renders a Latest AI News section when stories are present", () => {
    const txt = buildLlmsTxt({
      siteUrl,
      papers,
      stories: [
        {
          shortId: "story1",
          title: "OpenAI Ships New Model",
          summary: "A".repeat(200),
        },
      ],
    });
    expect(txt).toContain("## Latest AI News");
    expect(txt).toContain(
      "[OpenAI Ships New Model](https://picx.dev/news/story1)",
    );
    // Summary truncated to 150 chars with an ellipsis appended.
    expect(txt).toContain(`${"A".repeat(150)}...`);
    expect(txt).not.toContain("A".repeat(151));
  });

  it("omits the Latest AI News section when stories is absent or empty", () => {
    const txtAbsent = buildLlmsTxt({ siteUrl, papers });
    expect(txtAbsent).not.toContain("## Latest AI News");

    const txtEmpty = buildLlmsTxt({ siteUrl, papers, stories: [] });
    expect(txtEmpty).not.toContain("## Latest AI News");
  });

  it("escapes brackets and flattens newlines in link text", () => {
    const txt = buildLlmsTxt({
      siteUrl,
      papers: [
        {
          title: "RLHF [v2]\nrevisited",
          shortId: "ghi789",
          tldr: null,
        },
      ],
    });
    expect(txt).toContain(
      "- [RLHF \\[v2\\] revisited](https://picx.dev/p/ghi789.md)",
    );
  });

  it("escapes backslashes in link text before brackets", () => {
    const txt = buildLlmsTxt({
      siteUrl,
      papers: [
        {
          title: String.raw`Escaping LaTeX \] tokens`,
          shortId: "jkl012",
          tldr: null,
        },
      ],
    });
    expect(txt).toContain(
      String.raw`- [Escaping LaTeX \\\] tokens](https://picx.dev/p/jkl012.md)`,
    );
  });

  it("collapses newlines in story summaries into single spaces", () => {
    const txt = buildLlmsTxt({
      siteUrl,
      papers,
      stories: [
        {
          shortId: "story2",
          title: "Model ]breaks[ things",
          summary: "Line one.\nLine two.",
        },
      ],
    });
    expect(txt).toContain(
      "- [Model \\]breaks\\[ things](https://picx.dev/news/story2): Line one. Line two.",
    );
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

  it("inlines a Latest AI News section with full story summaries", () => {
    const stories = [
      {
        shortId: "story1",
        title: "OpenAI Ships New Model",
        summary: "Full detailed summary of the story goes here.",
      },
    ];
    const txt = buildLlmsFullTxt({
      siteUrl,
      papers,
      stories,
      maxBytes: 100_000,
    });
    expect(txt).toContain("## Latest AI News");
    expect(txt).toContain("## OpenAI Ships New Model");
    expect(txt).toContain("- **Permalink:** https://picx.dev/news/story1");
    expect(txt).toContain("Full detailed summary of the story goes here.");
  });

  it("omits the Latest AI News section when stories is absent or empty", () => {
    const txtAbsent = buildLlmsFullTxt({ siteUrl, papers, maxBytes: 100_000 });
    expect(txtAbsent).not.toContain("## Latest AI News");

    const txtEmpty = buildLlmsFullTxt({
      siteUrl,
      papers,
      stories: [],
      maxBytes: 100_000,
    });
    expect(txtEmpty).not.toContain("## Latest AI News");
  });

  it("flattens newlines in heading titles but leaves summary bodies raw", () => {
    const txt = buildLlmsFullTxt({
      siteUrl,
      papers: [
        {
          ...papers[0],
          title: "Attention\nIs All You Need",
        },
      ],
      stories: [
        {
          shortId: "story3",
          title: "Big\nNews",
          summary: "Para one.\n\nPara two.",
        },
      ],
      maxBytes: 100_000,
    });
    expect(txt).toContain("## Attention Is All You Need\n");
    expect(txt).toContain("## Big News\n");
    // Story summary bodies are intentionally raw markdown.
    expect(txt).toContain("Para one.\n\nPara two.");
  });
});
