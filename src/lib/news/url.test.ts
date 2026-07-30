import { describe, expect, it } from "vitest";
import { hashUrl, normalizeUrl } from "./url";

describe("normalizeUrl", () => {
  it("strips tracking params and keeps content params", () => {
    expect(normalizeUrl("https://a.com/post?utm_source=x&id=3&ref=hn")).toBe(
      "https://a.com/post?id=3",
    );
  });
  it("normalizes protocol, www, trailing slash and hash", () => {
    expect(normalizeUrl("http://www.A.com/post/#frag")).toBe(
      "https://a.com/post",
    );
  });
  it("sorts query params for stable hashing", () => {
    expect(normalizeUrl("https://a.com/p?b=2&a=1")).toBe(
      normalizeUrl("https://a.com/p?a=1&b=2"),
    );
  });
  it("keeps root path slash", () => {
    expect(normalizeUrl("https://a.com/")).toBe("https://a.com/");
  });
});

describe("hashUrl", () => {
  it("same normalized url yields same hash", async () => {
    const h1 = await hashUrl("https://www.a.com/post?utm_medium=rss");
    const h2 = await hashUrl("http://a.com/post/");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
