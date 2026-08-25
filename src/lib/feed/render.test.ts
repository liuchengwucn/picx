// src/lib/feed/render.test.ts
//
// 控制字符测试改用 String.fromCharCode 在运行时构造，源码文件本身不含任何
// 转义文本或字面控制字节：字面量在编辑器与剪贴板里不可见，复制时会静默丢失，
// 而反斜杠转义文本在这套工具链的传输过程中又可能被悄悄解码成真实控制字节，
// 两者都会让测试变成「什么都没测」。
import { describe, expect, it } from "vitest";
import { renderAtom } from "./render-atom";
import { renderJsonFeed } from "./render-json";
import { renderRss } from "./render-rss";
import { buildFeedChannelId, buildFeedItemId, type FeedChannel } from "./types";

const PUBLISHED = new Date("2026-08-25T08:12:00.000Z");
const UPDATED = new Date("2026-08-25T09:00:00.000Z");

function fixture(): FeedChannel {
  return {
    id: buildFeedChannelId("news", "zh-cn"),
    title: "PicX 快讯",
    subtitle: "AI 情报每日聚合",
    selfUrl: "https://picx.dev/rss/news.zh-cn.xml",
    htmlUrl: "https://picx.dev/news",
    localeKey: "zh-cn",
    bcp47: "zh-CN",
    alternates: [{ hreflang: "en", href: "https://picx.dev/rss/news.en.xml" }],
    updated: UPDATED,
    items: [
      {
        id: buildFeedItemId("news/abc123", "zh-cn"),
        title: 'Title & <Tag> "quotes"',
        url: "https://picx.dev/news/abc123",
        published: PUBLISHED,
        updated: UPDATED,
        contentHtml: "<p>摘要 &amp; 要点</p>",
        summaryText: "一句话摘要",
        categories: [{ term: "ai", label: "AI" }],
        image: { url: "https://picx.dev/img/abc123.jpg" },
      },
    ],
  };
}

describe("renderAtom", () => {
  it("escapes XML metacharacters in the title without breaking structure", () => {
    const out = renderAtom(fixture());
    expect(out).toContain(
      '<title type="text">Title &amp; &lt;Tag&gt; &quot;quotes&quot;</title>',
    );
    expect(out).not.toContain('Title & <Tag> "quotes"</title>');
  });

  it("double-escapes contentHtml (already-HTML-escaped source re-escaped for XML)", () => {
    const out = renderAtom(fixture());
    expect(out).toContain(
      '<content type="html">&lt;p&gt;摘要 &amp;amp; 要点&lt;/p&gt;</content>',
    );
  });

  it("emits xml:lang, self link, and hreflang alternates", () => {
    const out = renderAtom(fixture());
    expect(out).toContain('xml:lang="zh-CN"');
    expect(out).toContain(
      '<link rel="self" type="application/atom+xml" href="https://picx.dev/rss/news.zh-cn.xml"/>',
    );
    expect(out).toContain('hreflang="en"');
  });

  it("formats dates as RFC 3339", () => {
    const out = renderAtom(fixture());
    expect(out).toContain("<published>2026-08-25T08:12:00.000Z</published>");
    expect(out).toContain("<updated>2026-08-25T09:00:00.000Z</updated>");
  });

  it("strips control characters from titles", () => {
    const dirty = fixture();
    // 用 String.fromCharCode 在运行时构造控制字符，源码文件本身不含任何字面
    // 控制字节（也不含反斜杠转义文本），避免复制/传输链路把转义序列悄悄
    // 变成真实的控制字节写进文件。
    dirty.items[0].title = [
      "Bad",
      String.fromCharCode(0),
      "Title",
      String.fromCharCode(1),
      "Here",
      String.fromCharCode(31),
      "End",
    ].join("");
    const out = renderAtom(dirty);
    expect(out).toContain('<title type="text">BadTitleHereEnd</title>');
    // 只针对被剥掉的 C0 范围（排除合法保留的 tab/LF/CR，输出里本来就有换行）
    const hasForbiddenControlChar = Array.from(out).some((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13;
    });
    expect(hasForbiddenControlChar).toBe(false);
  });

  it("renders a well-formed feed with no items", () => {
    const empty = fixture();
    empty.items = [];
    const out = renderAtom(empty);
    expect(out).toContain("<feed");
    expect(out).toContain("</feed>");
    expect(out).not.toContain("<entry>");
  });

  it("pins the tag URI id format", () => {
    const out = renderAtom(fixture());
    expect(out).toContain("<id>tag:picx.dev,2026:news/abc123/zh-cn</id>");
  });
});

describe("renderRss", () => {
  it("uses a non-permalink guid carrying the tag URI and RFC 1123 pubDate", () => {
    const out = renderRss(fixture());
    expect(out).toContain(
      '<guid isPermaLink="false">tag:picx.dev,2026:news/abc123/zh-cn</guid>',
    );
    expect(out).toContain(`<pubDate>${PUBLISHED.toUTCString()}</pubDate>`);
  });

  it("uses the lowercase DB locale key, declares xmlns:atom, and emits atom:link rel=self", () => {
    const out = renderRss(fixture());
    expect(out).toContain("<language>zh-cn</language>");
    expect(out).toContain(
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    );
    expect(out).toContain('<atom:link rel="self"');
  });

  it("renders a well-formed feed with no items", () => {
    const empty = fixture();
    empty.items = [];
    const out = renderRss(empty);
    expect(out).toContain("<rss");
    expect(out).toContain("<channel>");
    expect(out).toContain("</channel>");
    expect(out).toContain("</rss>");
    expect(out).not.toContain("<item>");
  });
});

describe("renderJsonFeed", () => {
  it("parses as JSON with the expected top-level and item fields", () => {
    const out = renderJsonFeed(fixture());
    const parsed = JSON.parse(out);
    expect(parsed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(parsed.language).toBe("zh-CN");
    expect(parsed.items[0].id).toBe("tag:picx.dev,2026:news/abc123/zh-cn");
    expect(parsed.items[0].content_html).toBe("<p>摘要 &amp; 要点</p>");
    expect(parsed.items[0].image).toBe("https://picx.dev/img/abc123.jpg");
  });

  it("strips an unpaired surrogate from the title and still parses", () => {
    const dirty = fixture();
    dirty.items[0].title = "Bad\ud800Title";
    const out = renderJsonFeed(dirty);
    const parsed = JSON.parse(out);
    expect(parsed.items[0].title).toBe("BadTitle");
  });
});
