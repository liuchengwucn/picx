// src/lib/feed/render-atom.ts
import type { FeedChannel, FeedItem } from "./types";
import { xmlText } from "./xml";

const DEFAULT_IMAGE_MIME = "image/jpeg";

/**
 * 注意 contentHtml 的**双层转义**是对的，不是 bug：
 *
 * item-html.ts 组装时已经把标题里的 & 转成了 &amp;（那一层是 HTML）；这里
 * type="html" 的语义是「XML 解析出来的字符串是一段 HTML 源码」，所以 XML 层
 * 必须再转一次，写成 &amp;amp;，阅读器解析后才拿到正确的 HTML 源码 &amp;。
 * 少转一层的话，正文里的 <p> 会被当成 feed 结构的一部分把 XML 撑坏。
 */
function atomEntry(item: FeedItem): string {
  const parts = [
    `    <title type="text">${xmlText(item.title)}</title>`,
    `    <id>${xmlText(item.id)}</id>`,
    `    <link rel="alternate" type="text/html" href="${xmlText(item.url)}"/>`,
    `    <published>${item.published.toISOString()}</published>`,
    `    <updated>${item.updated.toISOString()}</updated>`,
  ];
  if (item.summaryText) {
    parts.push(
      `    <summary type="text">${xmlText(item.summaryText)}</summary>`,
    );
  }
  for (const c of item.categories ?? []) {
    parts.push(
      `    <category term="${xmlText(c.term)}" label="${xmlText(c.label)}"/>`,
    );
  }
  if (item.image) {
    const mime = item.image.mime ?? DEFAULT_IMAGE_MIME;
    parts.push(
      `    <link rel="enclosure" type="${xmlText(mime)}" href="${xmlText(item.image.url)}"/>`,
    );
  }
  parts.push(`    <content type="html">${xmlText(item.contentHtml)}</content>`);
  return `  <entry>\n${parts.join("\n")}\n  </entry>`;
}

export function renderAtom(channel: FeedChannel): string {
  const head = [
    `  <title>${xmlText(channel.title)}</title>`,
    `  <subtitle>${xmlText(channel.subtitle)}</subtitle>`,
    `  <id>${xmlText(channel.id)}</id>`,
    `  <updated>${channel.updated.toISOString()}</updated>`,
    `  <link rel="self" type="application/atom+xml" href="${xmlText(channel.selfUrl)}"/>`,
    `  <link rel="alternate" type="text/html" href="${xmlText(channel.htmlUrl)}"/>`,
  ];
  for (const alt of channel.alternates) {
    head.push(
      `  <link rel="alternate" type="application/atom+xml" hreflang="${xmlText(alt.hreflang)}" href="${xmlText(alt.href)}"/>`,
    );
  }
  const entries = channel.items.map(atomEntry).join("\n");
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${xmlText(channel.bcp47)}">`,
    head.join("\n"),
    entries,
    `</feed>`,
    ``,
  ]
    .filter((s) => s !== "")
    .join("\n");
}
