// src/lib/digest/sources.ts
import { XMLParser } from "fast-xml-parser";
import type { DirectionSourceConfig } from "#/db/schema";
import { canonicalArxivId, canonicalArxivUrl } from "#/lib/arxiv";
import { fetchFeed } from "#/lib/news/adapters/rss";
import type { CandidateItem } from "./types";

const ARXIV_API = "https://export.arxiv.org/api/query";
/** excerpt 截断上限；s2-fallback.ts 的 S2 兜底路径复用同一常量保持口径一致 */
export const MAX_EXCERPT = 1200;
/** 超长作者团队截断：保留前 AUTHORS_HEAD 位 + 末位 */
const AUTHORS_HEAD = 5;

/** arXiv 限流（429）专用错误类型：区别于源本身死亡，调用方需要走分钟级退避重试而非计入熔断 */
export class ArxivRateLimitError extends Error {
  constructor() {
    super("arxiv api: 429 (rate limited)");
    this.name = "ArxivRateLimitError";
  }
}

const atomParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (node && typeof node === "object" && "#text" in node) {
    return String((node as Record<string, unknown>)["#text"] ?? "");
  }
  return "";
}

/** 从 Atom entry 解析作者名单；>AUTHORS_HEAD+1 人截断为前 5 + 末位，authorCount 保留真实总数 */
export function parseAtomAuthors(entry: Record<string, unknown>): {
  authors?: string[];
  authorCount?: number;
} {
  const names = asArray(entry.author)
    .map((a) =>
      a && typeof a === "object" && "name" in a
        ? textOf((a as Record<string, unknown>).name).trim()
        : "",
    )
    .filter(Boolean);
  if (names.length === 0) return {};
  const authors =
    names.length > AUTHORS_HEAD + 1
      ? [...names.slice(0, AUTHORS_HEAD), names[names.length - 1]]
      : names;
  return { authors, authorCount: names.length };
}

/** arXiv Atom API：按查询式取窗口内新论文 */
export async function fetchArxivQuery(
  config: DirectionSourceConfig,
  windowStart: Date,
  sourceLabel: string,
): Promise<CandidateItem[]> {
  if (!config.query) throw new Error("arxiv_query source missing config.query");
  const url =
    `${ARXIV_API}?search_query=${encodeURIComponent(config.query)}` +
    `&sortBy=submittedDate&sortOrder=descending&max_results=${config.maxResults ?? 50}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "picx-digest-bot/1.0 (+https://picx.dev)" },
  });
  if (res.status === 429) throw new ArxivRateLimitError();
  if (!res.ok) throw new Error(`arxiv api: ${res.status}`);
  const xml = await res.text();
  const doc = atomParser.parse(xml) as {
    feed?: { entry?: unknown | unknown[] };
  };
  if (!doc.feed) {
    throw new Error("arxiv api: unrecognized response (no feed)");
  }
  const entries = asArray(doc.feed?.entry) as Array<Record<string, unknown>>;
  const items: CandidateItem[] = [];
  for (const e of entries) {
    const idUrl = textOf(e.id); // 形如 http://arxiv.org/abs/2508.01234v1
    const arxivId = canonicalArxivId(idUrl);
    if (!arxivId) continue;
    const published = new Date(textOf(e.published));
    if (Number.isNaN(published.getTime()) || published < windowStart) continue;
    items.push({
      canonicalUrl: canonicalArxivUrl(arxivId),
      title: textOf(e.title).replace(/\s+/g, " ").trim(),
      kind: "paper",
      excerpt: textOf(e.summary)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_EXCERPT),
      publishedAt: published.toISOString(),
      sourceLabel,
      ...parseAtomAuthors(e),
    });
  }
  return items;
}

/** RSS/Atom feed：博客等，产出 intel 候选 */
export async function fetchDirectionRss(
  config: DirectionSourceConfig,
  windowStart: Date,
  sourceLabel: string,
): Promise<CandidateItem[]> {
  if (!config.url) throw new Error("rss source missing config.url");
  const feedItems = await fetchFeed(config.url);
  return feedItems
    .filter((i) => i.publishedAt >= windowStart)
    .map((i) => ({
      canonicalUrl: i.url.trim(),
      title: i.title,
      kind: "intel" as const,
      excerpt: i.excerpt?.slice(0, MAX_EXCERPT),
      publishedAt: i.publishedAt.toISOString(),
      sourceLabel,
    }));
}

/** 按 adapterType 分发 */
export async function fetchDirectionSource(
  adapterType: "arxiv_query" | "rss",
  config: DirectionSourceConfig,
  windowStart: Date,
  sourceLabel: string,
): Promise<CandidateItem[]> {
  switch (adapterType) {
    case "arxiv_query":
      return fetchArxivQuery(config, windowStart, sourceLabel);
    case "rss":
      return fetchDirectionRss(config, windowStart, sourceLabel);
  }
}
