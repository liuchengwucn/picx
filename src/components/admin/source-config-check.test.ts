/**
 * 源 config 的前端镜像校验。这里只钉住「哪一种输入报哪一条」；「与后端判定逐条一致」
 * 由 integrations/trpc/routers/admin.test.ts 里那张前后端对照表钉住（它过的是真的
 * upsertSource procedure，不复述 schema）。
 */
import { describe, expect, it } from "vitest";
import { checkSourceConfig } from "./source-config-check";

const OK_URL = "https://example.com/feed.xml";

describe("checkSourceConfig 必填项", () => {
  it("arxiv_query 缺 query / 只有空白 / 类型不对 → 指名 query", () => {
    const missingQuery = { kind: "missing", field: "query" };
    expect(checkSourceConfig("arxiv_query", {})).toEqual(missingQuery);
    expect(checkSourceConfig("arxiv_query", { query: "   " })).toEqual(
      missingQuery,
    );
    expect(checkSourceConfig("arxiv_query", { query: 5 })).toEqual(
      missingQuery,
    );
    // 填了别的适配器的字段不算填
    expect(checkSourceConfig("arxiv_query", { url: OK_URL })).toEqual(
      missingQuery,
    );
  });

  it("rss 缺 url / 字段名拼错 → 指名 url", () => {
    const missingUrl = { kind: "missing", field: "url" };
    expect(checkSourceConfig("rss", {})).toEqual(missingUrl);
    // 拼错的键在后端会被 zod 的 strip 剥掉，这边读的是原始 JSON，结论要一致
    expect(checkSourceConfig("rss", { ur: OK_URL })).toEqual(missingUrl);
    expect(checkSourceConfig("rss", { query: "cat:cs.AI" })).toEqual(
      missingUrl,
    );
  });

  it("必填项齐了就放行", () => {
    expect(checkSourceConfig("arxiv_query", { query: "cat:cs.LO" })).toBeNull();
    expect(checkSourceConfig("rss", { url: OK_URL })).toBeNull();
  });

  it("切换适配器后残留的无关字段不拦（拦住站长就改不动配置了）", () => {
    expect(
      checkSourceConfig("rss", { url: OK_URL, query: "上一轮留下的" }),
    ).toBeNull();
    expect(
      checkSourceConfig("arxiv_query", { query: "cat:cs.LO", url: OK_URL }),
    ).toBeNull();
    // 未知键同样不报错：后端 strip 掉它，必填项还在，就该放行
    expect(checkSourceConfig("rss", { url: OK_URL, ur: "拼错的" })).toBeNull();
  });
});

describe("checkSourceConfig url 合法性", () => {
  it("漏 scheme / 压根不是 URL → bad_url", () => {
    expect(checkSourceConfig("rss", { url: "example.com/feed.xml" })).toEqual({
      kind: "bad_url",
    });
    expect(checkSourceConfig("rss", { url: "not a url" })).toEqual({
      kind: "bad_url",
    });
    expect(checkSourceConfig("rss", { url: "//a.com/feed.xml" })).toEqual({
      kind: "bad_url",
    });
  });

  /**
   * 复制粘贴带来的不可见前导/尾随空白**不该**被拦：后端 zod 4 的 url 检查会先 trim，
   * 这三种字符在屏幕上完全看不见，拦下去等于让站长对着一条「看起来完全正确」的 URL
   * 束手无策。三种都是 JS trim 认的空白，而 WHATWG 的 URL 解析都不认。
   */
  it("不换行空格 / 全角空格 / BOM 开头的合法 URL 照样放行", () => {
    for (const url of [
      ` ${OK_URL}`,
      `　${OK_URL}`,
      `﻿${OK_URL}`,
      `${OK_URL} `,
      `  ${OK_URL}  `,
    ]) {
      expect(checkSourceConfig("rss", { url }), JSON.stringify(url)).toBeNull();
    }
  });

  it("残留的非法 url 也要拦：后端的 .url() 不看 adapterType", () => {
    expect(
      checkSourceConfig("arxiv_query", {
        query: "cat:cs.LO",
        url: "example.com/feed.xml",
      }),
    ).toEqual({ kind: "bad_url" });
  });
});

describe("checkSourceConfig maxResults", () => {
  it("正整数放行，0 / 负数 / 小数 / 字符串 / null 拦住", () => {
    expect(
      checkSourceConfig("arxiv_query", { query: "q", maxResults: 50 }),
    ).toBeNull();
    for (const maxResults of [0, -1, 1.5, "50", null]) {
      expect(
        checkSourceConfig("arxiv_query", { query: "q", maxResults }),
        JSON.stringify(maxResults),
      ).toEqual({ kind: "bad_max_results" });
    }
  });

  it("不填 maxResults 是合法的（它不是必填项）", () => {
    expect(checkSourceConfig("arxiv_query", { query: "q" })).toBeNull();
    expect(
      checkSourceConfig("arxiv_query", { query: "q", maxResults: undefined }),
    ).toBeNull();
  });
});
