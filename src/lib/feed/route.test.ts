import { describe, expect, it } from "vitest";
import { parseFeedPath } from "./route";

describe("parseFeedPath", () => {
  it("解析资讯 feed", () => {
    expect(parseFeedPath("/rss/news.zh-cn.xml")).toEqual({
      type: "feed",
      request: {
        target: { kind: "news" },
        locale: { key: "zh-cn", bcp47: "zh-CN", paraglide: "zh-CN" },
        ext: "xml",
      },
    });
  });

  it("解析全方向合并 feed 的三种扩展名", () => {
    for (const ext of ["xml", "rss", "json"] as const) {
      const r = parseFeedPath(`/rss/digest.ja.${ext}`);
      expect(r).toMatchObject({
        type: "feed",
        request: { target: { kind: "digest-all" }, ext },
      });
    }
  });

  it("解析单方向 feed", () => {
    expect(parseFeedPath("/rss/digest/ai4formath.en.json")).toMatchObject({
      type: "feed",
      request: {
        target: { kind: "digest-direction", slug: "ai4formath" },
        ext: "json",
      },
    });
  });

  it("缺 locale 时 301 到 en 并保持扩展名", () => {
    expect(parseFeedPath("/rss/news.rss")).toEqual({
      type: "redirect",
      location: "/rss/news.en.rss",
    });
    expect(parseFeedPath("/rss/digest/llm.xml")).toEqual({
      type: "redirect",
      location: "/rss/digest/llm.en.xml",
    });
  });

  it("非法 locale 是 404，不是重定向", () => {
    expect(parseFeedPath("/rss/news.fr.xml")).toEqual({ type: "not-found" });
  });

  it("非法扩展名 / 未知 kind / 非法 slug 一律 404", () => {
    expect(parseFeedPath("/rss/news.zh-cn.txt")).toEqual({ type: "not-found" });
    expect(parseFeedPath("/rss/papers.en.xml")).toEqual({ type: "not-found" });
    expect(parseFeedPath("/rss/digest/Bad_Slug.en.xml")).toEqual({
      type: "not-found",
    });
    expect(parseFeedPath("/rss/news")).toEqual({ type: "not-found" });
    expect(parseFeedPath("/other/news.en.xml")).toEqual({ type: "not-found" });
  });
});
