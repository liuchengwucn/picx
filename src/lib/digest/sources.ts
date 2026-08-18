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

// arXiv Atom 标题偶带换行连字（"ATTEN-\n TION"）：连字符紧跟换行才视为断词伪影，
// 去掉连字符与换行拼回整词。悬垂连字（"intra- and inter-…"，换行后是 and/or，
// 大小写不限）是正当写法，必须保留连字符原样；普通连字词（Test-Time，无换行）
// 不受影响。已知局限：真连字复合词恰在自身连字符处被换行（"state-\nof-the-art"）
// 无法从文本区分，会被拼成 "stateof-the-art"——标题仅作展示、去重键是 canonicalUrl，
// 接受此风险。
export function dehyphenateWrappedTitle(raw: string): string {
  return raw.replace(/(\p{L})-\n\s*(?!(?:and|or)\b)(\p{L})/giu, "$1$2");
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
      title: dehyphenateWrappedTitle(textOf(e.title))
        .replace(/\s+/g, " ")
        .trim(),
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
  return (
    feedItems
      // publishedAtInferred: 源缺 pubDate/发布日期时 news 侧摄入把 publishedAt 兜底为
      // now（fail-open，供人工浏览排序用），digest 这里必须 fail-closed 丢弃——否则
      // 老文章会被伪装成本周新内容，击穿 7 天窗。
      .filter((i) => !i.publishedAtInferred && i.publishedAt >= windowStart)
      .map((i) => ({
        canonicalUrl: i.url.trim(),
        title: i.title,
        kind: "intel" as const,
        excerpt: i.excerpt?.slice(0, MAX_EXCERPT),
        publishedAt: i.publishedAt.toISOString(),
        sourceLabel,
      }))
  );
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
