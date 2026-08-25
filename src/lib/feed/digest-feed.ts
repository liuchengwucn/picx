// src/lib/feed/digest-feed.ts
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { digestPapers, digests, directions, papers } from "#/db/schema";
import { isWinningDigest } from "#/lib/digest/edition-store";
import { pickTldr } from "#/lib/tldr";
import { m } from "#/paraglide/messages";
import { buildDigestItemHtml, truncateNote } from "./item-html";
import { markdownLeadHtml } from "./markdown-lead";
import {
  buildFeedChannelId,
  buildFeedItemId,
  DIGEST_DIRECTION_FEED_LIMIT,
  DIGEST_FEED_LIMIT,
  FEED_LOCALES,
  type FeedChannel,
  type FeedItem,
  type FeedLocale,
} from "./types";

type Db = ReturnType<typeof drizzle>;

/**
 * 方向周报 feed。slug 为 null 时是全方向合并 feed。
 *
 * 返回 null 表示「这个 slug 不存在或方向已下线」—— 调用方要回 404 而不是空 feed。
 * 但方向存在、只是还没出过期时返回条目为空的合法 channel（那是正确状态）。
 */
export async function buildDigestFeed(
  db: Db,
  locale: FeedLocale,
  siteUrl: string,
  slug: string | null,
): Promise<FeedChannel | null> {
  let directionName: Record<string, string> | null = null;
  if (slug) {
    const [dir] = await db
      .select({ name: directions.name })
      .from(directions)
      .where(and(eq(directions.slug, slug), eq(directions.isActive, true)))
      .limit(1);
    if (!dir) return null;
    directionName = dir.name;
  }

  const limit = slug ? DIGEST_DIRECTION_FEED_LIMIT : DIGEST_FEED_LIMIT;
  const conditions = [
    eq(digests.status, "published"),
    eq(directions.isActive, true),
    isWinningDigest,
  ];
  if (slug) conditions.push(eq(directions.slug, slug));

  const rows = await db
    .select({
      id: digests.id,
      issueNumber: digests.issueNumber,
      title: digests.title,
      content: digests.content,
      publishedAt: digests.publishedAt,
      updatedAt: digests.updatedAt,
      directionSlug: directions.slug,
      directionName: directions.name,
    })
    .from(digests)
    .innerJoin(directions, eq(digests.directionId, directions.id))
    .where(and(...conditions))
    .orderBy(desc(digests.publishedAt))
    .limit(limit);

  // picks 用 inArray 而不是子查询：isWinningDigest 插值的是 digests 表限定符，
  // 塞进子查询会与子查询自己的别名冲突、静默失效。id 数量上限是 30（常量，不是
  // 用户输入），远低于 D1 的 100 个绑定参数上限，安全。
  const digestIds = rows.map((r) => r.id);
  const pickRows = digestIds.length
    ? await db
        .select({
          digestId: digestPapers.digestId,
          rank: digestPapers.rank,
          note: digestPapers.recommendationNote,
          shortId: papers.shortId,
          title: papers.title,
        })
        .from(digestPapers)
        .innerJoin(papers, eq(digestPapers.paperId, papers.id))
        .where(inArray(digestPapers.digestId, digestIds))
        .orderBy(asc(digestPapers.rank))
    : [];

  const picksByDigest = new Map<
    string,
    Array<{ url: string; title: string; note: string | null }>
  >();
  for (const p of pickRows) {
    if (!p.shortId) continue;
    const list = picksByDigest.get(p.digestId) ?? [];
    list.push({
      url: `${siteUrl}/p/${p.shortId}`,
      title: p.title,
      note: truncateNote(pickTldr(p.note, locale.key)),
    });
    picksByDigest.set(p.digestId, list);
  }

  const pl = locale.paraglide;
  const readFullLabel = m.rss_item_read_full({}, { locale: pl });

  const items: FeedItem[] = rows.map((row) => {
    const dirName =
      pickTldr(row.directionName, locale.key) ?? row.directionSlug;
    const issueUrl = `${siteUrl}/gallery/d/${row.directionSlug}/${row.issueNumber}`;
    const title =
      pickTldr(row.title, locale.key) ?? `${dirName} #${row.issueNumber}`;
    // publishedAt 理论上 published 行必有值，回退 updatedAt 只是防御
    const published = row.publishedAt ?? row.updatedAt;
    return {
      id: buildFeedItemId(
        `digest/${row.directionSlug}/${row.issueNumber}`,
        locale.key,
      ),
      title,
      url: issueUrl,
      published,
      updated: row.updatedAt,
      contentHtml: buildDigestItemHtml({
        leadHtml: markdownLeadHtml(pickTldr(row.content, locale.key)),
        picks: picksByDigest.get(row.id) ?? [],
        fullIssueUrl: issueUrl,
        fullIssueLabel: readFullLabel,
      }),
      categories: [{ term: row.directionSlug, label: dirName }],
    };
  });

  const localizedDirName = directionName
    ? (pickTldr(directionName, locale.key) ?? (slug as string))
    : null;
  const feedPath = slug ? `digest/${slug}` : "digest";

  return {
    id: buildFeedChannelId(feedPath, locale.key),
    title: localizedDirName
      ? m.rss_digest_direction_feed_title(
          { name: localizedDirName },
          { locale: pl },
        )
      : m.rss_digest_feed_title({}, { locale: pl }),
    subtitle: localizedDirName
      ? m.rss_digest_direction_feed_subtitle(
          { name: localizedDirName },
          { locale: pl },
        )
      : m.rss_digest_feed_subtitle({}, { locale: pl }),
    selfUrl: `${siteUrl}/rss/${feedPath}.${locale.key}.xml`,
    htmlUrl: slug ? `${siteUrl}/gallery/d/${slug}` : `${siteUrl}/gallery`,
    localeKey: locale.key,
    bcp47: locale.bcp47,
    alternates: FEED_LOCALES.filter((l) => l.key !== locale.key).map((l) => ({
      hreflang: l.bcp47,
      href: `${siteUrl}/rss/${feedPath}.${l.key}.xml`,
    })),
    updated: items[0]?.updated ?? new Date(0),
    items,
  };
}
