// src/lib/feed/render-rss.ts
import type { FeedChannel, FeedItem } from "./types";
import { xmlText } from "./xml";

const DEFAULT_IMAGE_MIME = "image/jpeg";

/**
 * RSS 2.0 的语言只有 channel 级一个 <language>，自身地址与语言互链都得借
 * Atom 命名空间（<atom:link>）—— 这是事实标准写法，不是 hack。
 * 日期用 RFC 1123（toUTCString），RSS 2.0 的 RFC 822 口径接受它。
 */
function rssItem(item: FeedItem): string {
  const parts = [
    `    <title>${xmlText(item.title)}</title>`,
    `    <link>${xmlText(item.url)}</link>`,
    // isPermaLink="false"：guid 是 tag URI 不是网址，不声明的话默认 true 会误导聚合器
    `    <guid isPermaLink="false">${xmlText(item.id)}</guid>`,
    `    <pubDate>${item.published.toUTCString()}</pubDate>`,
    `    <description>${xmlText(item.contentHtml)}</description>`,
  ];
  for (const c of item.categories ?? []) {
    parts.push(`    <category>${xmlText(c.label)}</category>`);
  }
  if (item.image) {
    const mime = item.image.mime ?? DEFAULT_IMAGE_MIME;
    // RSS 的 enclosure 要求 length 属性；真实字节数这里拿不到，按惯例填 0
    parts.push(
      `    <enclosure url="${xmlText(item.image.url)}" type="${xmlText(mime)}" length="0"/>`,
    );
  }
  return `  <item>\n${parts.join("\n")}\n  </item>`;
}

export function renderRss(channel: FeedChannel): string {
  const head = [
    `  <title>${xmlText(channel.title)}</title>`,
    `  <link>${xmlText(channel.htmlUrl)}</link>`,
    `  <description>${xmlText(channel.subtitle)}</description>`,
    `  <language>${xmlText(channel.localeKey)}</language>`,
    `  <lastBuildDate>${channel.updated.toUTCString()}</lastBuildDate>`,
    `  <atom:link rel="self" type="application/rss+xml" href="${xmlText(channel.selfUrl)}"/>`,
  ];
  for (const alt of channel.alternates) {
    head.push(
      `  <atom:link rel="alternate" type="application/rss+xml" hreflang="${xmlText(alt.hreflang)}" href="${xmlText(alt.href)}"/>`,
    );
  }
  const items = channel.items.map(rssItem).join("\n");
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    `<channel>`,
    head.join("\n"),
    items,
    `</channel>`,
    `</rss>`,
    ``,
  ]
    .filter((s) => s !== "")
    .join("\n");
}
