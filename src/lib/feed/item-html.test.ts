import { describe, expect, it } from "vitest";
import {
  buildDigestItemHtml,
  buildNewsItemHtml,
  truncateNote,
} from "./item-html";

describe("buildNewsItemHtml", () => {
  it("组装封面图、摘要、要点与来源", () => {
    const html = buildNewsItemHtml({
      summary: "摘要正文",
      keyFacts: ["要点一", "要点二"],
      sources: [
        { url: "https://a.example/1", sourceName: "TechCrunch" },
        { url: "https://b.example/2", sourceName: "Hacker News" },
      ],
      imageUrl: "https://picx.dev/api/news-image?u=x",
      sourcesLabel: "来源：",
    });
    expect(html).toBe(
      '<p><img src="https://picx.dev/api/news-image?u=x" alt=""/></p>' +
        "<p>摘要正文</p>" +
        "<ul><li>要点一</li><li>要点二</li></ul>" +
        '<p>来源：<a href="https://a.example/1">TechCrunch</a> · ' +
        '<a href="https://b.example/2">Hacker News</a></p>',
    );
  });

  it("keyFacts 为 null 时静默省略该块（既定契约，不是错误）", () => {
    const html = buildNewsItemHtml({
      summary: "摘要",
      keyFacts: null,
      sources: [],
      imageUrl: null,
      sourcesLabel: "来源：",
    });
    expect(html).toBe("<p>摘要</p>");
  });

  it("转义来源名与 URL 里的元字符", () => {
    const html = buildNewsItemHtml({
      summary: "",
      keyFacts: null,
      sources: [{ url: "https://x.example/?a=1&b=2", sourceName: "A & B" }],
      imageUrl: null,
      sourcesLabel: "来源：",
    });
    expect(html).toContain('href="https://x.example/?a=1&amp;b=2"');
    expect(html).toContain(">A &amp; B<");
  });
});

describe("buildDigestItemHtml", () => {
  it("导读 + picks + 回站链接", () => {
    const html = buildDigestItemHtml({
      leadHtml: "<p>导读</p>",
      picks: [
        { url: "https://picx.dev/p/a1", title: "论文甲", note: "值得读" },
        { url: "https://picx.dev/p/a2", title: "论文乙", note: null },
      ],
      fullIssueUrl: "https://picx.dev/gallery/d/llm/12",
      fullIssueLabel: "阅读全期 →",
    });
    expect(html).toBe(
      "<p>导读</p>" +
        '<ol><li><a href="https://picx.dev/p/a1">论文甲</a> — 值得读</li>' +
        '<li><a href="https://picx.dev/p/a2">论文乙</a></li></ol>' +
        '<p><a href="https://picx.dev/gallery/d/llm/12">阅读全期 →</a></p>',
    );
  });

  it("没有 picks 时仍给出回站链接", () => {
    const html = buildDigestItemHtml({
      leadHtml: "",
      picks: [],
      fullIssueUrl: "https://picx.dev/gallery/d/llm/12",
      fullIssueLabel: "阅读全期 →",
    });
    expect(html).toBe(
      '<p><a href="https://picx.dev/gallery/d/llm/12">阅读全期 →</a></p>',
    );
  });
});

describe("truncateNote", () => {
  it("超长截断并加省略号", () => {
    expect(truncateNote("x".repeat(200))).toBe(`${"x".repeat(160)}…`);
  });
  it("空白与 null 归一成 null", () => {
    expect(truncateNote("   ")).toBeNull();
    expect(truncateNote(null)).toBeNull();
  });
});
