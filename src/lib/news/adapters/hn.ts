import type { NewsSourceConfig } from "#/db/schema";
import type { NormalizedItem } from "../types";

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  points: number | null;
  num_comments: number | null;
  author: string;
  created_at_i: number;
}

export function hitToItem(hit: AlgoliaHit): NormalizedItem | null {
  if (!hit.title) return null;
  const hnUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  return {
    url: hit.url ?? hnUrl,
    title: hit.title,
    author: hit.author,
    publishedAt: new Date(hit.created_at_i * 1000),
    signals: { points: hit.points ?? 0, comments: hit.num_comments ?? 0 },
    extra: { hnId: hit.objectID, hnUrl },
  };
}

/** 按关键词逐个查 Algolia search_by_date，objectID 去重合并 */
export async function fetchHn(
  config: NewsSourceConfig,
  since: Date,
): Promise<NormalizedItem[]> {
  const seen = new Set<string>();
  const items: NormalizedItem[] = [];
  for (const query of config.queries ?? []) {
    const params = new URLSearchParams({
      query,
      tags: "story",
      numericFilters: `created_at_i>${Math.floor(since.getTime() / 1000)},points>=${config.minPoints ?? 30}`,
      hitsPerPage: "50",
    });
    const response = await fetch(
      `https://hn.algolia.com/api/v1/search_by_date?${params}`,
    );
    if (!response.ok) throw new Error(`HN Algolia: HTTP ${response.status}`);
    const data = (await response.json()) as { hits: AlgoliaHit[] };
    for (const hit of data.hits) {
      if (seen.has(hit.objectID)) continue;
      seen.add(hit.objectID);
      const item = hitToItem(hit);
      if (item) items.push(item);
    }
  }
  return items;
}

/** 信号回刷用官方 Firebase API（轻量，无需拉整棵评论树） */
export async function fetchHnItemSignals(
  hnId: string,
): Promise<{ points: number; comments: number } | null> {
  const response = await fetch(
    `https://hacker-news.firebaseio.com/v0/item/${hnId}.json`,
  );
  if (!response.ok) return null;
  const data = (await response.json()) as {
    score?: number;
    descendants?: number;
  } | null;
  if (!data) return null;
  return { points: data.score ?? 0, comments: data.descendants ?? 0 };
}
