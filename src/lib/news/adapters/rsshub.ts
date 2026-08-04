import type { NewsSourceConfig } from "#/db/schema";
import type { NormalizedItem } from "../types";
import { fetchFeed, stripHtml } from "./rss";

const TWEET_TITLE_MAX = 140;

/**
 * 自建 RSSHub 实例：本质是 RSS。accessKey 以 ?key= 附加（实例开启 ACCESS_KEY 鉴权）。
 * config.isTweet 的路由做推文特化——标题截短、标记 extra.isTweet 供过滤/摘要 prompt
 * 与 signals 的 xAccounts 统计区分；博客类路由原样透传。
 */
export async function fetchRsshub(
  baseUrl: string,
  config: NewsSourceConfig,
  accessKey?: string,
): Promise<NormalizedItem[]> {
  const route = config.route ?? "";
  const url = new URL(`${baseUrl.replace(/\/$/, "")}${route}`);
  if (accessKey) url.searchParams.set("key", accessKey);
  const items = await fetchFeed(url.toString());
  if (!config.isTweet) return items;
  return items.map((item) => {
    const text = stripHtml(item.title);
    const chars = [...text]; // 按 Unicode code point 切分，避免把 emoji 等代理对拦腰截断
    return {
      ...item,
      title:
        chars.length > TWEET_TITLE_MAX
          ? `${chars.slice(0, TWEET_TITLE_MAX).join("")}…`
          : text,
      extra: { ...item.extra, isTweet: true },
    };
  });
}
