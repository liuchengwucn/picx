import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArxivRateLimitError,
  dehyphenateWrappedTitle,
  fetchArxivQuery,
  fetchDirectionRss,
  parseAtomAuthors,
} from "./sources";

describe("dehyphenateWrappedTitle", () => {
  it("rejoins a hyphen immediately followed by a line break", () => {
    expect(dehyphenateWrappedTitle("ATTEN-\n TION mechanisms")).toBe(
      "ATTENTION mechanisms",
    );
  });

  it("keeps a suspended hyphen unchanged when the break is followed by and/or", () => {
    expect(dehyphenateWrappedTitle("Intra-\n and Inter-Layer Attention")).toBe(
      "Intra-\n and Inter-Layer Attention",
    );
  });

  it("keeps an ALL-CAPS suspended hyphen unchanged (case-insensitive and/or)", () => {
    expect(dehyphenateWrappedTitle("INTRA-\n AND INTER-LAYER")).toBe(
      "INTRA-\n AND INTER-LAYER",
    );
  });

  it("leaves a plain hyphenated word (no line break) unchanged", () => {
    expect(dehyphenateWrappedTitle("Test-Time Training")).toBe(
      "Test-Time Training",
    );
  });

  it("leaves a plain wrap without a hyphen unchanged", () => {
    expect(dehyphenateWrappedTitle("Sparse\n Attention")).toBe(
      "Sparse\n Attention",
    );
  });

  it("leaves a hyphen followed by a plain space (no line break) unchanged", () => {
    expect(dehyphenateWrappedTitle("ATTEN- TION")).toBe("ATTEN- TION");
  });
});

describe("parseAtomAuthors", () => {
  it("returns empty object when entry has no authors", () => {
    expect(parseAtomAuthors({})).toEqual({});
  });

  it("parses a single author object (fast-xml-parser unwraps single-element arrays)", () => {
    expect(parseAtomAuthors({ author: { name: "Alice Chen" } })).toEqual({
      authors: ["Alice Chen"],
      authorCount: 1,
    });
  });

  it("keeps all authors when count is at most 6", () => {
    const entry = {
      author: ["A", "B", "C", "D", "E", "F"].map((n) => ({ name: n })),
    };
    expect(parseAtomAuthors(entry)).toEqual({
      authors: ["A", "B", "C", "D", "E", "F"],
      authorCount: 6,
    });
  });

  it("truncates more than 6 authors to first 5 + last, keeping the true total", () => {
    const entry = {
      author: ["A", "B", "C", "D", "E", "F", "G", "H"].map((n) => ({
        name: n,
      })),
    };
    expect(parseAtomAuthors(entry)).toEqual({
      authors: ["A", "B", "C", "D", "E", "H"],
      authorCount: 8,
    });
  });

  it("skips malformed author nodes and blank names", () => {
    const entry = { author: [{ name: "A" }, {}, "junk", { name: "  " }] };
    expect(parseAtomAuthors(entry)).toEqual({
      authors: ["A"],
      authorCount: 1,
    });
  });
});

describe("fetchArxivQuery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects with ArxivRateLimitError on 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "",
      }),
    );
    await expect(
      fetchArxivQuery({ query: "cat:cs.AI" }, new Date(0), "test-source"),
    ).rejects.toBeInstanceOf(ArxivRateLimitError);
  });

  it("rejects with a plain Error (not ArxivRateLimitError) on 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "",
      }),
    );
    const promise = fetchArxivQuery(
      { query: "cat:cs.AI" },
      new Date(0),
      "test-source",
    );
    await expect(promise).rejects.toBeInstanceOf(Error);
    await expect(promise).rejects.not.toBeInstanceOf(ArxivRateLimitError);
  });
});

describe("fetchDirectionRss", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops items with an inferred (missing pubDate) date even if fetched within the window", async () => {
    // 一条有真实近期 pubDate、一条缺 pubDate（news 侧兜底为 now，落进任何窗口）——
    // digest 侧必须 fail-closed 丢弃后者，否则老文章会伪装成本周新内容。
    const xml = `<?xml version="1.0"?><rss version="2.0">
<channel><title>Blog</title>
<item>
  <title>Dated post</title>
  <link>https://blog.example.com/dated</link>
  <pubDate>Wed, 29 Jul 2026 10:00:00 GMT</pubDate>
</item>
<item>
  <title>Undated post</title>
  <link>https://blog.example.com/undated</link>
</item>
</channel></rss>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => xml,
      }),
    );
    const items = await fetchDirectionRss(
      { url: "https://blog.example.com/feed.xml" },
      new Date("2026-07-01T00:00:00Z"),
      "test-blog",
    );
    expect(items).toHaveLength(1);
    expect(items[0].canonicalUrl).toBe("https://blog.example.com/dated");
  });
});
