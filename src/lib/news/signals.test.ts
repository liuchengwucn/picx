import { describe, expect, it } from "vitest";
import { buildSignalsSummary } from "./signals";

const rss = (url: string) => ({
  url,
  author: null,
  signals: null,
  extra: null,
  sourceType: "rss" as const,
});

describe("buildSignalsSummary", () => {
  it("returns empty domains for no items", () => {
    expect(buildSignalsSummary([])).toEqual({ domains: [] });
  });
  it("dedupes domains preserving order", () => {
    const s = buildSignalsSummary([
      rss("https://openai.com/a"),
      rss("https://www.openai.com/b"),
      rss("https://hn.com/c"),
    ]);
    expect(s.domains).toEqual(["openai.com", "hn.com"]);
  });
  it("picks highest-points HN mention", () => {
    const s = buildSignalsSummary([
      {
        url: "https://x.com/1",
        author: "a",
        signals: { points: 10, comments: 2 },
        extra: { hnUrl: "https://news.ycombinator.com/item?id=1" },
        sourceType: "hn",
      },
      {
        url: "https://x.com/2",
        author: "b",
        signals: { points: 99, comments: 5 },
        extra: { hnUrl: "https://news.ycombinator.com/item?id=2" },
        sourceType: "hn",
      },
    ]);
    expect(s.hn).toEqual({
      points: 99,
      comments: 5,
      url: "https://news.ycombinator.com/item?id=2",
    });
  });
  it("detects HN by extra.hnUrl even on an rss-sourced row", () => {
    // URL 撞车去重后，HN 帖的 signals/extra 会落在 rss 来源的行上
    const s = buildSignalsSummary([
      {
        url: "https://openai.com/blog/x",
        author: null,
        signals: { points: 42, comments: 7 },
        extra: { hnUrl: "https://news.ycombinator.com/item?id=9" },
        sourceType: "rss",
      },
    ]);
    expect(s.hn).toEqual({
      points: 42,
      comments: 7,
      url: "https://news.ycombinator.com/item?id=9",
    });
  });
  it("ignores rows without hnUrl", () => {
    expect(
      buildSignalsSummary([rss("https://openai.com/a")]).hn,
    ).toBeUndefined();
  });
  it("counts distinct X accounts", () => {
    const tweet = (author: string) => ({
      url: `https://nitter/${author}`,
      author,
      signals: null,
      extra: null,
      sourceType: "rsshub" as const,
    });
    expect(
      buildSignalsSummary([tweet("a"), tweet("a"), tweet("b")]).xAccounts,
    ).toBe(2);
  });
});
