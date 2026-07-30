import { XMLParser } from "fast-xml-parser";
import type { NewsMedia } from "#/db/schema";
import type { NormalizedItem } from "../types";

const USER_AGENT = "picx-news-bot/1.0 (+https://picx.dev)";
const MAX_EXCERPT = 1000;
const MAX_ITEMS_PER_FEED = 50;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
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

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractImages(html: string): NewsMedia[] {
  const media: NewsMedia[] = [];
  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    if (match[1].startsWith("http"))
      media.push({ type: "image", url: match[1] });
    if (media.length >= 4) break;
  }
  return media;
}

function parseDate(value: unknown): Date | null {
  const date = new Date(textOf(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 解析 RSS 2.0 或 Atom，容忍字段缺失；无法确定链接的条目丢弃 */
export function parseFeed(xml: string): NormalizedItem[] {
  const doc = parser.parse(xml);
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
      String(enclosure?.["@_type"] ?? "").startsWith("image")
    ) {
      media.unshift({ type: "image", url: enclosureUrl });
    }
    items.push({
      url,
      title: stripHtml(textOf(item.title)) || url,
      excerpt: stripHtml(rawContent).slice(0, MAX_EXCERPT) || undefined,
      author:
        stripHtml(textOf(item["dc:creator"]) || textOf(item.author)) ||
        undefined,
      publishedAt: parseDate(item.pubDate) ?? new Date(),
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
    items.push({
      url,
      title: stripHtml(textOf(entry.title)) || url,
      excerpt: stripHtml(rawContent).slice(0, MAX_EXCERPT) || undefined,
      author: stripHtml(textOf(author?.name)) || undefined,
      publishedAt: parseDate(entry.published ?? entry.updated) ?? new Date(),
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
  });
  if (!response.ok) throw new Error(`feed ${url}: HTTP ${response.status}`);
  return parseFeed(await response.text());
}
