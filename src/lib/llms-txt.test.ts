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

const digests = [
  {
    directionSlug: "ai4formath",
    issueNumber: 1,
    title: "Issue 1: Formalization hits research level",
    content: "## Highlights\n\nAutoformalization moved past competition math.",
  },
  {
    directionSlug: "ai4formath",
    issueNumber: 2,
    title: "Issue 2: Verifier-guided search",
    content: "## Highlights\n\nProof search now leans on learned verifiers.",
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

  it("links the gallery page and not the retired about page", () => {
    const txt = buildLlmsTxt({ siteUrl, papers });
    expect(txt).toContain("(https://picx.dev/gallery)");
    expect(txt).not.toContain("/about");
  });

  it("links the archive and drops the retired daily-update claim", () => {
    const txt = buildLlmsTxt({ siteUrl, papers });
    expect(txt).toContain("(https://picx.dev/gallery/archive)");
    // /gallery 现在一周才换一期; 报错的更新节奏比不报更糟(爬虫会按日回抓)
    expect(txt).not.toContain("updated daily");
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

  it("renders a digests section linking each issue page", () => {
    const txt = buildLlmsTxt({ siteUrl, papers, digests });
    expect(txt).toContain("## Research Direction Digests");
    expect(txt).toContain(
      "- [Issue 1: Formalization hits research level](https://picx.dev/gallery/d/ai4formath/1)",
    );
    expect(txt).toContain(
      "- [Issue 2: Verifier-guided search](https://picx.dev/gallery/d/ai4formath/2)",
    );
  });

  it("omits the digests section when digests is absent or empty", () => {
    expect(buildLlmsTxt({ siteUrl, papers })).not.toContain(
      "## Research Direction Digests",
    );
    expect(buildLlmsTxt({ siteUrl, papers, digests: [] })).not.toContain(
      "## Research Direction Digests",
    );
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
    // 这个 1100 不是「随手调大」的数字: 它的唯一作用是让预算恰好落在「header 之后、
    // 正文之中」—— 装得下 header + 第一篇 + 一行截断说明(~1048B), 装不下第二篇
    // (~1161B), 于是丢弃路径真的被走到。
    //
    // 它随 header 文案浮动: header 本身是无条件输出的(buildLlmsFullTxt 不对它做预算
    // 检查), 所以一旦 header 涨过这个数, 一篇正文都进不来, 断言 bytes <= maxBytes
    // 反而恒真, 这条测试就静默退化成「只测了 header」——它已经因为 Pages 里加了
    // Archive 一条而发生过一次(旧值 700)。往 Pages 加行、改站点简介之后, 必须把这个
    // 数字一起顶上去(取 header + 第一篇 + 说明 与 header + 两篇 之间的任意值)。
    const txt = buildLlmsFullTxt({ siteUrl, papers, maxBytes: 1100 });
    const bytes = new TextEncoder().encode(txt).length;
    expect(bytes).toBeLessThanOrEqual(1100);
    // The second paper must not fully fit in such a small budget.
    expect(txt).not.toContain(
      "Residual connections ease optimization of deep networks.",
    );
  });

  it("notes when papers were omitted for size", () => {
    const txt = buildLlmsFullTxt({ siteUrl, papers, maxBytes: 1100 });
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

  it("inlines a digests section with the full English issue body", () => {
    const txt = buildLlmsFullTxt({
      siteUrl,
      papers,
      digests,
      maxBytes: 100_000,
    });
    expect(txt).toContain("## Research Direction Digests");
    expect(txt).toContain("## Issue 1: Formalization hits research level");
    expect(txt).toContain(
      "- **Permalink:** https://picx.dev/gallery/d/ai4formath/1",
    );
    expect(txt).toContain("Autoformalization moved past competition math.");
  });

  it("omits the digests section when digests is absent or empty", () => {
    expect(
      buildLlmsFullTxt({ siteUrl, papers, maxBytes: 100_000 }),
    ).not.toContain("## Research Direction Digests");
    expect(
      buildLlmsFullTxt({ siteUrl, papers, digests: [], maxBytes: 100_000 }),
    ).not.toContain("## Research Direction Digests");
  });

  it("drops overflow digests and notes how many were omitted", () => {
    const bigDigests = [
      {
        directionSlug: "ai4formath",
        issueNumber: 1,
        title: "Issue 1",
        content: "A".repeat(4000),
      },
      {
        directionSlug: "ai4formath",
        issueNumber: 2,
        title: "Issue 2",
        content: "B".repeat(4000),
      },
    ];
    const maxBytes = 6000;
    const txt = buildLlmsFullTxt({
      siteUrl,
      papers: [],
      digests: bigDigests,
      maxBytes,
    });
    expect(new TextEncoder().encode(txt).length).toBeLessThanOrEqual(maxBytes);
    expect(txt).toContain("A".repeat(4000));
    expect(txt).not.toContain("B".repeat(4000));
    expect(txt).toContain("_1 more digest(s) omitted for size._");
  });

  it("drops the whole digests section when papers already spent the budget", () => {
    // 预算只够 header + 第一篇论文, 简报小节整个不出现 (不留孤立空标题)。
    const txt = buildLlmsFullTxt({ siteUrl, papers, digests, maxBytes: 700 });
    expect(txt).not.toContain("## Research Direction Digests");
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
