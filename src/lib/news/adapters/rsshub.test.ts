import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRsshub } from "./rsshub";

const FEED = (title: string) => `<?xml version="1.0"?><rss version="2.0">
<channel><title>Feed</title>
<item>
  <title><![CDATA[${title}]]></title>
  <link>https://example.com/post</link>
  <pubDate>Wed, 29 Jul 2026 10:00:00 GMT</pubDate>
  <description>body</description>
</item>
</channel></rss>`;

function stubFetch(xml: string): { requested: () => string } {
  let requested = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      requested = String(url);
      return new Response(xml, { status: 200 });
    }),
  );
  return { requested: () => requested };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRsshub", () => {
  it("appends access key and strips trailing slash from base url", async () => {
    const spy = stubFetch(FEED("Hello"));
    await fetchRsshub(
      "https://rsshub.example.com/",
      { route: "/kimi/blog" },
      "sekret",
    );
    expect(spy.requested()).toBe(
      "https://rsshub.example.com/kimi/blog?key=sekret",
    );
  });
  it("passes blog items through untouched (no isTweet)", async () => {
    stubFetch(FEED("A".repeat(200)));
    const items = await fetchRsshub("https://rsshub.example.com", {
      route: "/kimi/blog",
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toHaveLength(200); // 不截断
    expect(items[0].extra?.isTweet).toBeUndefined();
  });
  it("truncates title and marks extra.isTweet for tweet routes", async () => {
    stubFetch(FEED("A".repeat(200)));
    const items = await fetchRsshub("https://rsshub.example.com", {
      route: "/twitter/user/karpathy",
      isTweet: true,
    });
    expect(items[0].title).toHaveLength(141); // 140 + 省略号
    expect(items[0].title.endsWith("…")).toBe(true);
    expect(items[0].extra?.isTweet).toBe(true);
  });
  it("omits key param when no access key configured", async () => {
    const spy = stubFetch(FEED("Hello"));
    await fetchRsshub("https://rsshub.example.com", { route: "/r" });
    expect(spy.requested()).toBe("https://rsshub.example.com/r");
  });
});
