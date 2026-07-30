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

/**
 * 按关键词逐个查 Algolia search_by_date，objectID 去重合并。
 *
 * `since` 语义注意：过滤条件是 `created_at_i>since AND points>=minPoints` 的合取，
 * 不是「先按时间窗，再看当前分数」。一个故事不可能在诞生几小时内就冲到 30+ 分，
 * 而一旦它老到窗口之外，就再也不会因为「现在」终于攒够分数而被重新捕获——于是短窗口
 * （例如 1-3 小时的 hourly since）会让这条查询永远返回 0 条。调用方（pipeline）必须
 * 传入一个足够宽松的回溯窗口（当前设计是 72 小时），配合 objectID 去重来避免重复入库，
 * 而不是依赖缩短窗口来减少重复。
 */
export async function fetchHn(
  config: NewsSourceConfig,
  since: Date,
): Promise<NormalizedItem[]> {
  const seen = new Set<string>();
  const items: NormalizedItem[] = [];
  const queries = config.queries ?? [];
  let failures = 0;
  for (const query of queries) {
    try {
      const params = new URLSearchParams({
        query,
        tags: "story",
        numericFilters: `created_at_i>${Math.floor(since.getTime() / 1000)},points>=${config.minPoints ?? 30}`,
        hitsPerPage: "50",
      });
      const response = await fetch(
        `https://hn.algolia.com/api/v1/search_by_date?${params}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!response.ok) throw new Error(`HN Algolia: HTTP ${response.status}`);
      const data = (await response.json()) as { hits: AlgoliaHit[] };
      for (const hit of data.hits) {
        if (seen.has(hit.objectID)) continue;
        seen.add(hit.objectID);
        const item = hitToItem(hit);
        if (item) items.push(item);
      }
    } catch (error) {
      failures++;
      // 单条 query 失败（超时/限流/网络抖动）不应牵连其他 query；仅当全部失败才向上抛出，
      // 以保留来源失败计数的可观测性
      console.error(`fetchHn: query "${query}" failed`, error);
    }
  }
  if (queries.length > 0 && failures === queries.length) {
    throw new Error(
      `fetchHn: all ${queries.length} quer${queries.length === 1 ? "y" : "ies"} failed`,
    );
  }
  return items;
}

/** 信号回刷用官方 Firebase API（轻量，无需拉整棵评论树） */
export async function fetchHnItemSignals(
  hnId: string,
): Promise<{ points: number; comments: number } | null> {
  const response = await fetch(
    `https://hacker-news.firebaseio.com/v0/item/${encodeURIComponent(hnId)}.json`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) return null;
  const data = (await response.json()) as {
    score?: number;
    descendants?: number;
  } | null;
  if (!data) return null;
  return { points: data.score ?? 0, comments: data.descendants ?? 0 };
}
