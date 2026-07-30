import type { NewsSourceConfig } from "#/db/schema";
import type { NormalizedItem } from "../types";
import { fetchFeed, stripHtml } from "./rss";

const TWEET_TITLE_MAX = 140;

/** X via RSSHub：本质是 RSS，推文特化——标题截短、标记 isTweet 供过滤/摘要 prompt 区分 */
export async function fetchRsshub(
  baseUrl: string,
  config: NewsSourceConfig,
): Promise<NormalizedItem[]> {
  const route = config.route ?? "";
  const items = await fetchFeed(`${baseUrl.replace(/\/$/, "")}${route}`);
  return items.map((item) => {
    const text = stripHtml(item.title);
    return {
      ...item,
      title:
        text.length > TWEET_TITLE_MAX
          ? `${text.slice(0, TWEET_TITLE_MAX)}…`
          : text,
      extra: { ...item.extra, isTweet: true },
    };
  });
}
