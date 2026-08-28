// src/lib/news/visibility.ts
import { type SQL, sql } from "drizzle-orm";
import { newsStories } from "#/db/schema";

/**
 * 资讯 story 的站点可见性谓词——唯一定义处。
 *
 * 判据是 `summarized_at IS NOT NULL`（曾成功生成过四语正文），**不是** `dirty = 0`：
 * dirty 只是 summarize 的工作队列标记，一条已成熟 story 被新成员并入时也会置 dirty，
 * 那时它四语内容齐全、只是少算一条成员，隐藏它是纯损失（生产实测：7 天内 24% 的
 * 新 story 会在成熟后被再次并入，每次从列表消失至多一小时——而被持续跟进的恰恰是
 * 最值得展示的热点）。真正必须隐藏的是 cluster 刚建、从未 summarize 成功的占位
 * story：title 只有 `{en: 原标题}`、summary 是 excerpt。
 *
 * **谓词必须逐字是字面量 SQL。** partial index 只匹配字面量谓词，改写成 drizzle 的
 * `ne()` / `isNotNull()`（渲染为绑定参数）会让 news_stories_feed_published_idx /
 * news_stories_feed_active_idx（partial 谓词 `status != 'hidden'`，是本谓词的合取
 * 子集）静默失配，退化成全表扫描。
 */
export function newsVisible(): SQL {
  return sql`${newsStories.status} != 'hidden' AND ${newsStories.summarizedAt} IS NOT NULL`;
}

/**
 * 同一谓词的裸 SQL 文本，给手写表名的子查询用（配 `sql.raw`）。
 * 与 {@link newsVisible} 必须同步，改一个就要改另一个。
 */
export const NEWS_VISIBLE_SQL_TEXT =
  "status != 'hidden' AND summarized_at IS NOT NULL";
