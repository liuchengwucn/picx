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
  it("returns empty for unknown xml", () => {
    expect(parseFeed("<html></html>")).toEqual([]);
  });
});

describe("stripHtml", () => {
  it("removes tags and decodes basic entities", () => {
    expect(stripHtml("<p>a &amp; b</p>")).toBe("a & b");
  });
});
