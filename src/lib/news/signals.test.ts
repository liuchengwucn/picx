import { describe, expect, it } from "vitest";
import { buildSignalsSummary } from "./signals";

const rss = (url: string) => ({
  url,
  author: null,
  signals: null,
  extra: null,
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
      },
      {
        url: "https://x.com/2",
        author: "b",
        signals: { points: 99, comments: 5 },
        extra: { hnUrl: "https://news.ycombinator.com/item?id=2" },
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
  it("counts distinct X accounts by extra.isTweet", () => {
    const tweet = (author: string) => ({
      url: `https://nitter/${author}`,
      author,
      signals: null,
      extra: { isTweet: true },
    });
    expect(
      buildSignalsSummary([tweet("a"), tweet("a"), tweet("b")]).xAccounts,
    ).toBe(2);
  });
  it("does not count blog items from rsshub routes as X accounts", () => {
    // 博客路由同样走 rsshub 类型，但没有 isTweet 标记，不应计入 xAccounts
    const s = buildSignalsSummary([
      {
        url: "https://www.kimi.com/blog/kimi-k3",
        author: "Kimi Team",
        signals: null,
        extra: null,
      },
    ]);
    expect(s.xAccounts).toBeUndefined();
  });
});
