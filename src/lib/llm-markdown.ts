/**
 * 把一篇公开论文渲染成自包含的 Markdown 文档, 供 AI 检索爬虫 / `/p/{id}.md`
 * 路由直接取用 —— 相比完整 HTML 去掉了导航、脚本等噪音, token 占用大幅降低。
 *
 * 设计要点 (对齐 GEO 实践):
 * - 标题做 H1, 一句话总结 (tldr) 做引用块, 方便 LLM 摘要/引用。
 * - 来源、发布日、白板图、永久链接以列表给出, 让模型能回链到权威出处。
 * - 正文 summary 原样保留 (本就是 Markdown)。
 * - 结尾注明出处页面, 不靠 UA 嗅探切换内容 (避免被判定为 cloaking)。
 */
export interface PaperMarkdownInput {
  title: string;
  shortId: string;
  /** 选定语言的 Markdown 正文摘要; 缺失时省略 Summary 段。 */
  summary: string | null;
  /** 选定语言的一句话总结; 缺失时省略引用块。 */
  tldr: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  publishedAt: Date | string | null;
  hasWhiteboard: boolean;
  /** 站点根 URL, 不含尾斜杠, 如 https://picx.dev */
  siteUrl: string;
}

function toIsoDate(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split("T")[0];
}

export function buildPaperMarkdown(input: PaperMarkdownInput): string {
  const permalink = `${input.siteUrl}/p/${input.shortId}`;
  const lines: string[] = [`# ${input.title}`];

  if (input.tldr) {
    lines.push("", `> ${input.tldr}`);
  }

  const meta: string[] = [];
  if (input.sourceType === "arxiv" && input.sourceUrl) {
    meta.push(`- **Source:** [arXiv](${input.sourceUrl})`);
  } else if (input.sourceType === "arxiv") {
    meta.push("- **Source:** arXiv");
  } else {
    meta.push("- **Source:** Uploaded PDF");
  }
  const published = toIsoDate(input.publishedAt);
  if (published) {
    meta.push(`- **Published:** ${published}`);
  }
  meta.push(`- **Permalink:** ${permalink}`);
  if (input.hasWhiteboard) {
    meta.push(`- **Whiteboard:** ${permalink}/image`);
  }
  lines.push("", ...meta);

  if (input.summary) {
    lines.push("", "## Summary", "", input.summary);
  }

  lines.push(
    "",
    "---",
    "",
    `_Markdown view of ${permalink}, served by PicX — AI-generated visual whiteboard summaries of research papers._`,
  );

  return `${lines.join("\n")}\n`;
}
