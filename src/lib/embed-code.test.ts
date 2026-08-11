import { describe, expect, it } from "vitest";
import {
  buildEmbedCode,
  buildSocialShareLinks,
  escapeHtml,
  paperImageUrl,
  paperPageUrl,
  paperPdfPageUrl,
  parsePdfPageParam,
} from "./embed-code";

describe("escapeHtml", () => {
  it("escapes each special character", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml(`"`)).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  it("escapes & first so entities are not double-encoded", () => {
    expect(escapeHtml(`A & B <c> "d" 'e'`)).toBe(
      "A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#39;",
    );
  });

  it("leaves a clean string unchanged", () => {
    expect(escapeHtml("Attention Is All You Need")).toBe(
      "Attention Is All You Need",
    );
  });
});

describe("paperPageUrl / paperImageUrl", () => {
  it("builds absolute URLs from SITE_URL", () => {
    expect(paperPageUrl("abc123")).toBe("https://picx.dev/p/abc123");
    expect(paperImageUrl("abc123")).toBe("https://picx.dev/p/abc123/image");
  });
});

describe("buildEmbedCode", () => {
  it("contains the page backlink, stable image URL, and escaped title in alt", () => {
    const code = buildEmbedCode("abc123", `Attention & "All" <you> Need`);
    expect(code).toContain('href="https://picx.dev/p/abc123"');
    expect(code).toContain('src="https://picx.dev/p/abc123/image"');
    expect(code).toContain(
      'alt="Attention &amp; &quot;All&quot; &lt;you&gt; Need — Visual whiteboard summary by PicX"',
    );
    expect(code).toContain('href="https://picx.dev">PicX</a>');
  });
});

describe("buildSocialShareLinks", () => {
  it("builds URL-encoded share intents for X, Weibo, Reddit", () => {
    const links = buildSocialShareLinks("abc123", "Hello World & More");
    const encodedUrl = encodeURIComponent("https://picx.dev/p/abc123");
    const encodedTitle = encodeURIComponent("Hello World & More");
    expect(links.twitter).toBe(
      `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
    );
    expect(links.weibo).toBe(
      `https://service.weibo.com/share/share.php?url=${encodedUrl}&title=${encodedTitle}`,
    );
    expect(links.reddit).toBe(
      `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`,
    );
  });
});

describe("paperPdfPageUrl / parsePdfPageParam", () => {
  it("拼出带页码的 PDF 深链", () => {
    expect(paperPdfPageUrl("abc123", 7)).toContain("/p/abc123?view=pdf&page=7");
  });

  it("只接受正整数页码", () => {
    expect(parsePdfPageParam("7")).toBe(7);
    expect(parsePdfPageParam(7)).toBe(7);
    expect(parsePdfPageParam("0")).toBeUndefined();
    expect(parsePdfPageParam("-3")).toBeUndefined();
    expect(parsePdfPageParam("1.5")).toBeUndefined();
    expect(parsePdfPageParam("abc")).toBeUndefined();
    expect(parsePdfPageParam(undefined)).toBeUndefined();
  });
});
