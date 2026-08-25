// src/lib/feed/item-html.ts
import { escapeHtml } from "#/lib/embed-code";
import { stripInvalidXmlChars } from "./xml";

/** 一条 story 在 feed 里最多列几个来源 */
export const MAX_ITEM_SOURCES = 8;

/** 推荐语在 feed 里的截断长度 */
export const MAX_PICK_NOTE_CHARS = 160;

function esc(value: string): string {
  return escapeHtml(stripInvalidXmlChars(value));
}

export function truncateNote(
  note: string | null | undefined,
  max: number = MAX_PICK_NOTE_CHARS,
): string | null {
  if (!note) return null;
  const t = note.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export interface NewsItemHtmlInput {
  summary: string;
  /** NULL 是既定契约（key_facts 未处理），不是错误：静默省略这一块 */
  keyFacts: string[] | null;
  sources: Array<{ url: string; sourceName: string }>;
  /** 已经过 displayImageUrl() 的站内可取地址；null 表示这条没有封面 */
  imageUrl: string | null;
  /** 例："来源：" / "Sources: " —— 由调用方按 locale 传入 */
  sourcesLabel: string;
}

export function buildNewsItemHtml(input: NewsItemHtmlInput): string {
  const parts: string[] = [];
  if (input.imageUrl) {
    parts.push(`<p><img src="${esc(input.imageUrl)}" alt=""/></p>`);
  }
  if (input.summary.trim()) {
    parts.push(`<p>${esc(input.summary)}</p>`);
  }
  if (input.keyFacts && input.keyFacts.length > 0) {
    const items = input.keyFacts.map((f) => `<li>${esc(f)}</li>`).join("");
    parts.push(`<ul>${items}</ul>`);
  }
  if (input.sources.length > 0) {
    const links = input.sources
      .slice(0, MAX_ITEM_SOURCES)
      .map((s) => `<a href="${esc(s.url)}">${esc(s.sourceName)}</a>`)
      .join(" · ");
    parts.push(`<p>${esc(input.sourcesLabel)}${links}</p>`);
  }
  return parts.join("");
}

export interface DigestItemHtmlInput {
  /** markdownLeadHtml 的产物，已是 HTML，不再转义 */
  leadHtml: string;
  picks: Array<{ url: string; title: string; note: string | null }>;
  fullIssueUrl: string;
  /** 例："阅读全期 →" —— 由调用方按 locale 传入 */
  fullIssueLabel: string;
}

export function buildDigestItemHtml(input: DigestItemHtmlInput): string {
  const parts: string[] = [];
  if (input.leadHtml) parts.push(input.leadHtml);
  if (input.picks.length > 0) {
    const items = input.picks
      .map((p) => {
        const link = `<a href="${esc(p.url)}">${esc(p.title)}</a>`;
        return p.note
          ? `<li>${link} — ${esc(p.note)}</li>`
          : `<li>${link}</li>`;
      })
      .join("");
    parts.push(`<ol>${items}</ol>`);
  }
  parts.push(
    `<p><a href="${esc(input.fullIssueUrl)}">${esc(input.fullIssueLabel)}</a></p>`,
  );
  return parts.join("");
}
