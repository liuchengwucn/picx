import { describe, expect, it } from "vitest";
import { parseFeed, stripHtml } from "./rss";

const RSS2 = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Blog</title>
<item>
  <title><![CDATA[Scaling Laws <revisited>]]></title>
  <link>https://blog.example.com/scaling</link>
  <pubDate>Wed, 29 Jul 2026 10:00:00 GMT</pubDate>
  <description><![CDATA[<p>We study <b>pretraining</b>.</p><img src="https://blog.example.com/fig.png">]]></description>
</item>
<item><title>No link item</title></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<title>Lab</title>
<entry>
  <title>MoE architecture notes</title>
  <link rel="alternate" href="https://lab.example.com/moe"/>
  <published>2026-07-28T08:00:00Z</published>
  <author><name>Alice</name></author>
  <summary>Sparse experts.</summary>
</entry></feed>`;

describe("parseFeed", () => {
  it("parses RSS 2.0 with CDATA, drops linkless items, extracts images", () => {
    const items = parseFeed(RSS2);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Scaling Laws"); // stripHtml 会把 "<revisited>" 当标签移除
    expect(items[0].url).toBe("https://blog.example.com/scaling");
    expect(items[0].excerpt).toContain("We study pretraining");
    expect(items[0].media?.[0]).toEqual({
      type: "image",
      url: "https://blog.example.com/fig.png",
    });
    expect(items[0].publishedAt.toISOString()).toBe("2026-07-29T10:00:00.000Z");
  });
  it("parses Atom entries", () => {
    const items = parseFeed(ATOM);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      url: "https://lab.example.com/moe",
      title: "MoE architecture notes",
      author: "Alice",
      excerpt: "Sparse experts.",
    });
  });
  it("throws on unrecognized root structure instead of silently returning []", () => {
    // 200 的 HTML 错误页也会被 fast-xml-parser 解析成对象，但既非 rss.channel 也非 feed，
    // 必须抛出，否则死掉的源永远不会被计入失败计数
    expect(() => parseFeed("<html></html>")).toThrow(
      /unrecognized feed format/,
    );
  });

  it("returns [] for a recognized feed with zero items", () => {
    expect(
      parseFeed(
        '<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>',
      ),
    ).toEqual([]);
  });
});

describe("stripHtml", () => {
  it("removes tags and decodes basic entities", () => {
    expect(stripHtml("<p>a &amp; b</p>")).toBe("a & b");
  });

  it("decodes numeric decimal and hex entities", () => {
    const apostrophe = String.fromCodePoint(0x2019);
    expect(stripHtml("I&#8217;ve seen &#x2019; things")).toBe(
      `I${apostrophe}ve seen ${apostrophe} things`,
    );
  });

  it("decodes &amp; last so double-escaped entities are not over-decoded", () => {
    expect(stripHtml("literal &amp;lt;div&amp;gt;")).toBe(
      "literal &lt;div&gt;",
    );
  });

  it("removes script/style elements including their body", () => {
    expect(
      stripHtml(
        '<p>keep</p><script>alert("x")</script><style>.a{color:red}</style><p>me</p>',
      ),
    ).toBe("keep me");
  });
});
