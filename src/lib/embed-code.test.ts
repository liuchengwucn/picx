import { describe, expect, it } from "vitest";
import {
  buildEmbedCode,
  buildSocialShareLinks,
  escapeHtml,
  paperImageUrl,
  paperPageUrl,
} from "./embed-code";

describe("escapeHtml", () => {
  it("escapes &, <, >, and double quotes", () => {
    expect(escapeHtml(`A & B <c> "d"`)).toBe("A &amp; B &lt;c&gt; &quot;d&quot;");
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
