// src/lib/feed/news-feed.ts
import { desc, eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import {
  type NewsMedia,
  newsItems,
  newsSources,
  newsStories,
} from "#/db/schema";
import { displayImageUrl } from "#/lib/news/image-source";
import { pickTldr } from "#/lib/tldr";
import { m } from "#/paraglide/messages";
import { buildNewsItemHtml } from "./item-html";
import {
  buildFeedChannelId,
  buildFeedItemId,
  FEED_LOCALES,
  type FeedChannel,
  type FeedItem,
  type FeedLocale,
  NEWS_FEED_LIMIT,
} from "./types";

type Db = ReturnType<typeof drizzle>;

/**
 * 资讯 feed。
 *
 * 不复用 news.list：那是给分页/搜索/游标用的，既不查 key_facts 也不查来源条目。
 * 但**谓词必须逐字沿用** —— `status != 'hidden' AND dirty = 0` 的字面量写法是
 * partial index（news_stories_feed_published_idx）的匹配前提，换成 ne()/eq()
 * 会静默退化成全表扫描；dirty=0 更不能省，占位 story 只有英文半成品，推给订阅
 * 者就收不回来了。
 */
export async function buildNewsFeed(
  db: Db,
  locale: FeedLocale,
  siteUrl: string,
): Promise<FeedChannel> {
  const visible = sql`${newsStories.status} != 'hidden' AND ${newsStories.dirty} = 0`;

  const rows = await db
    .select({
      id: newsStories.id,
      shortId: newsStories.shortId,
      title: newsStories.title,
      summary: newsStories.summary,
      keyFacts: newsStories.keyFacts,
      leadImage: newsStories.leadImage,
      tags: newsStories.tags,
      firstSeenAt: newsStories.firstSeenAt,
      eventPublishedAt: newsStories.eventPublishedAt,
      lastActivityAt: newsStories.lastActivityAt,
    })
    .from(newsStories)
    .where(visible)
    .orderBy(desc(newsStories.eventPublishedAt), desc(newsStories.shortId))
    .limit(NEWS_FEED_LIMIT);

  // 来源用子查询限定，不给 inArray 传 50 个 id：D1 单查询绑定参数上限是 100，
  // 那种写法在「哪天把 limit 调到 80」时会静默炸掉。子查询零绑定参数。
  // 本查询是多表 join（innerJoin newsSources），插值 Column 不会被 drizzle 的
  // 单表限定符剥离优化影响；子查询内部一律手写表名。
  const sourceRows = rows.length
    ? await db
        .select({
          storyId: newsItems.storyId,
          url: newsItems.url,
          publishedAt: newsItems.publishedAt,
          sourceName: newsSources.name,
        })
        .from(newsItems)
        .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
        .where(
          // 排序键必须与主查询逐字一致（含 short_id 这个次级键）：news 是每小时
          // 批量聚合，同秒 earliest_published_at 并不罕见，只按时间排的话两个
          // 查询会在 LIMIT 边界上选出不同的 50 条，于是某条 story 的来源列表
          // 静默变空。仓库里那条复合游标（news.list 的 cursor）就是同一个坑。
          // 注意：裸 SQL 里的列名是 earliest_published_at，TS 侧字段叫
          // eventPublishedAt —— 语义已改为事件锚点，物理列名是历史遗留，见 schema.ts。
          sql`${newsItems.storyId} IN (
            SELECT id FROM news_stories
            WHERE status != 'hidden' AND dirty = 0
            ORDER BY earliest_published_at DESC, short_id DESC
            LIMIT ${NEWS_FEED_LIMIT}
          )`,
        )
        .orderBy(newsItems.publishedAt)
    : [];

  const sourcesByStory = new Map<
    string,
    Array<{ url: string; sourceName: string }>
  >();
  for (const r of sourceRows) {
    if (!r.storyId) continue;
    const list = sourcesByStory.get(r.storyId) ?? [];
    // 同一来源可能贡献多条 item，按来源名去重，保留最早那条的链接
    if (!list.some((s) => s.sourceName === r.sourceName)) {
      list.push({ url: r.url, sourceName: r.sourceName });
    }
    sourcesByStory.set(r.storyId, list);
  }

  const pl = locale.paraglide;
  const sourcesLabel = m.rss_item_sources({}, { locale: pl });

  const items: FeedItem[] = rows.map((row) => {
    const lead = row.leadImage as NewsMedia | null;
    // 外站图床（qbitai / 机器之心一类）直连必 403，阅读器只会拿到坏图。
    // displayImageUrl 已封装「要不要走站内代理」的判断。
    const imageUrl = lead?.url ? displayImageUrl(lead.url) : null;
    // published 用 eventPublishedAt（事件锚点），列 nullable 只是历史
    // 原因，写入路径始终赋值；回退 firstSeenAt（收录时间）。
    const published = row.eventPublishedAt ?? row.firstSeenAt;
    const summary = pickTldr(row.summary, locale.key) ?? "";
    const keyFacts =
      (row.keyFacts as Record<string, string[]> | null)?.[locale.key] ?? null;

    return {
      id: buildFeedItemId(`news/${row.shortId}`, locale.key),
      title: pickTldr(row.title, locale.key) ?? row.shortId,
      url: `${siteUrl}/news/${row.shortId}`,
      published,
      // story 并入新成员时 lastActivityAt 会更新，阅读器据此显示「有更新」
      updated: row.lastActivityAt,
      contentHtml: buildNewsItemHtml({
        summary,
        keyFacts,
        sources: sourcesByStory.get(row.id) ?? [],
        imageUrl,
        sourcesLabel,
      }),
      summaryText: summary || undefined,
      categories: (row.tags ?? []).map((t) => ({ term: t, label: t })),
      ...(imageUrl ? { image: { url: imageUrl } } : {}),
    };
  });

  return {
    id: buildFeedChannelId("news", locale.key),
    title: m.rss_news_feed_title({}, { locale: pl }),
    subtitle: m.rss_news_feed_subtitle({}, { locale: pl }),
    selfUrl: `${siteUrl}/rss/news.${locale.key}.xml`,
    htmlUrl: `${siteUrl}/news`,
    localeKey: locale.key,
    bcp47: locale.bcp47,
    alternates: FEED_LOCALES.filter((l) => l.key !== locale.key).map((l) => ({
      hreflang: l.bcp47,
      href: `${siteUrl}/rss/news.${l.key}.xml`,
    })),
    // 空 feed 用 epoch 0：ETag 需要一个确定值，而「没有条目」不该每次请求都变
    updated: items[0]?.updated ?? new Date(0),
    items,
  };
}
