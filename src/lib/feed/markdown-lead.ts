// src/lib/feed/markdown-lead.ts
import { escapeHtml } from "#/lib/embed-code";
import { stripInvalidXmlChars } from "./xml";

/** 导读默认取几个块 */
export const DEFAULT_LEAD_BLOCKS = 3;

// 只允许这些协议出现在 href 里。digest 正文是自家 LLM 产出的，但 feed 会被原样
// 渲染进别人的阅读器，javascript: 一类必须挡在生成侧。
const SAFE_HREF_RE = /^(https?:\/\/|\/)/i;

function inline(text: string): string {
  // 先整体转义，再把受支持的标记还原成标签。顺序不能反：反了会把正文里的
  // <script> 当成标记处理。
  let s = escapeHtml(stripInvalidXmlChars(text));
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (whole, label: string, href: string) =>
      SAFE_HREF_RE.test(href) ? `<a href="${href}">${label}</a>` : whole,
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

/**
 * markdown 的受限子集 → HTML，取前 maxBlocks 个块。
 *
 * 「块」= 一个段落，或一整个列表（含全部列表项）。纯标题块跳过且不计数
 * （feed item 已经有自己的标题）。
 *
 * 刻意不引 remark/rehype：项目里只有 react-markdown（React 组件），服务端拿
 * 不到 markdown→HTML 字符串管线，为 feed 单独装一套依赖不划算。表格、图片、
 * LaTeX 一律降级成纯文本原样输出 —— feed 里没有 KaTeX，公式显示成 $...$ 是
 * 所有技术类 feed 的常态，不专门处理。
 */
export function markdownLeadHtml(
  md: string | null | undefined,
  maxBlocks: number = DEFAULT_LEAD_BLOCKS,
): string {
  if (!md) return "";
  const out: string[] = [];
  for (const chunk of md.split(/\n\s*\n/)) {
    if (out.length >= maxBlocks) break;
    const lines = chunk
      .split("\n")
      .map((l) => l.trim())
      // 剥掉代码围栏标记行，围栏内的内容当普通文本
      .filter((l) => l !== "" && !l.startsWith("```"));
    // 标题行不进正文也不计数
    const body = lines.filter((l) => !l.startsWith("#"));
    if (body.length === 0) continue;

    if (body.every((l) => /^[-*]\s+/.test(l))) {
      const items = body
        .map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ""))}</li>`)
        .join("");
      out.push(`<ul>${items}</ul>`);
      continue;
    }
    if (body.every((l) => /^\d+[.)]\s+/.test(l))) {
      const items = body
        .map((l) => `<li>${inline(l.replace(/^\d+[.)]\s+/, ""))}</li>`)
        .join("");
      out.push(`<ol>${items}</ol>`);
      continue;
    }
    out.push(`<p>${inline(body.join(" "))}</p>`);
  }
  return out.join("");
}
