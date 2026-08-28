// src/lib/news/visibility.test.ts
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { NEWS_VISIBLE_SQL_TEXT, newsVisible } from "./visibility";

const dialect = new SQLiteSyncDialect();

// 这组断言存在的唯一理由：可见性谓词必须渲染成**字面量** SQL。
// 改成 ne() / isNotNull() 后功能完全正常、测试若只测语义也照样绿，
// 但 news_stories 的 partial index 会静默失配、列表查询退化成全表扫描。
describe("newsVisible", () => {
  it("renders the exact literal predicate with zero bound params", () => {
    const query = dialect.sqlToQuery(newsVisible());
    expect(query.sql).toBe(
      `"news_stories"."status" != 'hidden' AND "news_stories"."summarized_at" IS NOT NULL`,
    );
    expect(query.params).toEqual([]);
  });

  it("returns a fresh SQL object each call (no shared mutable state)", () => {
    expect(newsVisible()).not.toBe(newsVisible());
  });

  it("keeps the raw-SQL twin in sync with the drizzle predicate", () => {
    expect(NEWS_VISIBLE_SQL_TEXT).toBe(
      "status != 'hidden' AND summarized_at IS NOT NULL",
    );
    // 逐字同构：去掉表限定符后两者必须完全一致
    const query = dialect.sqlToQuery(newsVisible());
    expect(query.sql.replaceAll(/"news_stories"\."(\w+)"/g, "$1")).toBe(
      NEWS_VISIBLE_SQL_TEXT,
    );
  });
});
