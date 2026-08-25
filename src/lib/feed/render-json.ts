// src/lib/feed/render-json.ts
import type { FeedChannel } from "./types";
import { stripInvalidXmlChars } from "./xml";

/**
 * JSON Feed 1.1。JSON 本身不需要实体转义，但仍要剥控制字符 —— 未配对代理项会
 * 让 JSON.stringify 产出无法被严格解析器接受的输出。
 *
 * JSON Feed 没有 hreflang 互链的概念，alternates 直接省略（不硬造字段）。
 */
export function renderJsonFeed(channel: FeedChannel): string {
  const clean = stripInvalidXmlChars;
  return JSON.stringify(
    {
      version: "https://jsonfeed.org/version/1.1",
      title: clean(channel.title),
      description: clean(channel.subtitle),
      home_page_url: channel.htmlUrl,
      feed_url: channel.selfUrl,
      language: channel.bcp47,
      items: channel.items.map((item) => ({
        id: item.id,
        url: item.url,
        title: clean(item.title),
        content_html: clean(item.contentHtml),
        ...(item.summaryText ? { summary: clean(item.summaryText) } : {}),
        date_published: item.published.toISOString(),
        date_modified: item.updated.toISOString(),
        ...(item.image ? { image: item.image.url } : {}),
        ...(item.categories?.length
          ? { tags: item.categories.map((c) => clean(c.label)) }
          : {}),
      })),
    },
    null,
    2,
  );
}
