import { XMLParser } from "fast-xml-parser";
import type { NewsMedia } from "#/db/schema";
import { MAX_EXCERPT } from "../enrich";
import type { NormalizedItem } from "../types";

const USER_AGENT = "picx-news-bot/1.0 (+https://picx.dev)";
const MAX_ITEMS_PER_FEED = 50;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // 防止 <title>0755</title> 之类被强转成 number
  parseTagValue: false,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// fast-xml-parser 对 CDATA/属性混合节点会给对象（{"#text": ...}），统一取文本
function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (node && typeof node === "object" && "#text" in node) {
    return String((node as Record<string, unknown>)["#text"] ?? "");
  }
  return "";
}

// 命名实体表：fast-xml-parser 不解码 CDATA/文本中的实体，真实 feed 常见 &#8217; 等数字实体
// 以及一小撮排版用命名实体，这里覆盖常见集合（不追求完整 HTML5 实体表）
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
};

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ") // 先整块删除脚本/样式，避免其内容混入正文
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      try {
        return String.fromCodePoint(Number(dec));
      } catch {
        return "";
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      try {
        return String.fromCodePoint(Number.parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(
      /&([a-z]+);/gi,
      (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
    )
    .replace(/&amp;/g, "&") // 必须最后解码，否则会把 &amp;lt; 之类的双重转义提前展开
    .replace(/\s+/g, " ")
    .trim();
}

function extractImages(html: string): NewsMedia[] {
  const seen = new Set<string>();
  const media: NewsMedia[] = [];
  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const url = match[1];
    if (!url.startsWith("http") || seen.has(url)) continue;
    seen.add(url);
    media.push({ type: "image", url });
    if (media.length >= 4) break;
  }
  return media;
}

const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;

function parseDate(value: unknown): Date | null {
  const date = new Date(textOf(value));
  if (Number.isNaN(date.getTime())) return null;
  // 部分源的服务器时钟不准，会把条目发布时间标成未来，导致排序永远置顶；钳制为当前时间
  if (date.getTime() > Date.now() + MAX_FUTURE_SKEW_MS) return new Date();
  return date;
}

/**
 * 解析 RSS 2.0 或 Atom，容忍字段缺失；无法确定链接的条目丢弃。
 * 若根结构既非 rss.channel 也非 feed（例如源挂了返回一个 200 的 HTML 错误页），
 * 视为解析失败并抛出，交由调用方计入来源失败计数；只有「确实是 feed 但零条目」才返回 []。
 */
export function parseFeed(xml: string): NormalizedItem[] {
  const doc = parser.parse(xml);
  if (!doc?.rss?.channel && !doc?.feed) {
    throw new Error("parseFeed: unrecognized feed format");
  }
  const items: NormalizedItem[] = [];

  const rssItems = asArray<Record<string, unknown>>(doc?.rss?.channel?.item);
  for (const item of rssItems.slice(0, MAX_ITEMS_PER_FEED)) {
    const url = textOf(item.link).trim();
    if (!url.startsWith("http")) continue;
    const rawContent =
      textOf(item["content:encoded"]) || textOf(item.description);
    const media = extractImages(rawContent);
    const enclosure = item.enclosure as Record<string, unknown> | undefined;
    const enclosureUrl = enclosure?.["@_url"];
    if (
      typeof enclosureUrl === "string" &&
      String(enclosure?.["@_type"] ?? "").startsWith("image") &&
      !media.some((m) => m.url === enclosureUrl)
    ) {
      media.unshift({ type: "image", url: enclosureUrl });
    }
    const parsedPubDate = parseDate(item.pubDate);
    items.push({
      url,
      title: stripHtml(textOf(item.title)) || url,
      excerpt: stripHtml(rawContent).slice(0, MAX_EXCERPT) || undefined,
      author:
        stripHtml(textOf(item["dc:creator"]) || textOf(item.author)) ||
        undefined,
      publishedAt: parsedPubDate ?? new Date(),
      publishedAtInferred: parsedPubDate ? undefined : true,
      media: media.length > 0 ? media.slice(0, 4) : undefined,
    });
  }

  const atomEntries = asArray<Record<string, unknown>>(doc?.feed?.entry);
  for (const entry of atomEntries.slice(0, MAX_ITEMS_PER_FEED)) {
    const links = asArray<Record<string, unknown>>(
      entry.link as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | undefined,
    );
    const alt = links.find((l) => l["@_rel"] === "alternate") ?? links[0];
    const url =
      typeof alt?.["@_href"] === "string" ? (alt["@_href"] as string) : "";
    if (!url.startsWith("http")) continue;
    const rawContent = textOf(entry.content) || textOf(entry.summary);
    const media = extractImages(rawContent);
    const author = entry.author as Record<string, unknown> | undefined;
    const parsedPubDate = parseDate(entry.published ?? entry.updated);
    items.push({
      url,
      title: stripHtml(textOf(entry.title)) || url,
      excerpt: stripHtml(rawContent).slice(0, MAX_EXCERPT) || undefined,
      author: stripHtml(textOf(author?.name)) || undefined,
      publishedAt: parsedPubDate ?? new Date(),
      publishedAtInferred: parsedPubDate ? undefined : true,
      media: media.length > 0 ? media : undefined,
    });
  }

  return items;
}

export async function fetchFeed(url: string): Promise<NormalizedItem[]> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml",
    },
    // 覆盖 RSSHub 路由冷缓存渲染（实测 30s+）；fetch 逐源串行共享整轮 11min 预算，
    // 不能再放宽太多——挂起源每个最多偷走一个超时周期
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`feed ${url}: HTTP ${response.status}`);
  return parseFeed(await response.text());
}
