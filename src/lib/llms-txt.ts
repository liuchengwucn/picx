/**
 * 生成 llms.txt / llms-full.txt —— 给 AI 爬虫的站点级入口。
 *
 * - llms.txt: 站点概要 + 平铺的论文索引 (链接到各自的 .md 视图) + 关键页面。
 *   画廊页是客户端渲染的, 爬虫看不到列表; 这份平铺索引正好补上这张地图。
 * - llms-full.txt: 在概要之上内联每篇论文的完整摘要, 受字节预算约束,
 *   超出预算的论文整篇丢弃并在末尾注明 (避免静默截断 = 谎报覆盖)。
 *
 * 默认英文, 契合「英文占 AI 引用 83%」的事实。
 */

const SITE_DESCRIPTION =
  "AI-generated visual whiteboard summaries of research papers from arXiv and HuggingFace Daily Papers.";

const SITE_INTRO =
  "PicX turns academic papers into one-glance visual whiteboards plus concise summaries. Each paper links to a clean Markdown view intended for AI consumption.";

interface LlmsTxtPaper {
  title: string;
  shortId: string;
  tldr: string | null;
}

interface LlmsFullPaper extends LlmsTxtPaper {
  summary: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
}

function header(siteUrl: string): string {
  return [
    "# PicX",
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    SITE_INTRO,
    "",
    "## Pages",
    "",
    `- [Gallery](${siteUrl}/gallery): Browse every visual paper summary, updated daily.`,
    `- [About](${siteUrl}/about): What PicX is and how it works.`,
  ].join("\n");
}

export function buildLlmsTxt(input: {
  siteUrl: string;
  papers: LlmsTxtPaper[];
}): string {
  const lines = [header(input.siteUrl), "", "## Papers", ""];
  for (const p of input.papers) {
    const link = `- [${p.title}](${input.siteUrl}/p/${p.shortId}.md)`;
    lines.push(p.tldr ? `${link}: ${p.tldr}` : link);
  }
  return `${lines.join("\n")}\n`;
}

function paperBlock(siteUrl: string, p: LlmsFullPaper): string {
  const lines = [`## ${p.title}`];
  if (p.tldr) lines.push("", `> ${p.tldr}`);
  const source =
    p.sourceType === "arxiv" && p.sourceUrl
      ? `[arXiv](${p.sourceUrl})`
      : p.sourceType === "arxiv"
        ? "arXiv"
        : "Uploaded PDF";
  lines.push(
    "",
    `- **Source:** ${source}`,
    `- **Permalink:** ${siteUrl}/p/${p.shortId}`,
  );
  if (p.summary) lines.push("", p.summary);
  return lines.join("\n");
}

export function buildLlmsFullTxt(input: {
  siteUrl: string;
  papers: LlmsFullPaper[];
  maxBytes: number;
}): string {
  const encoder = new TextEncoder();
  const head = `${header(input.siteUrl)}\n`;
  const byteLen = (s: string) => encoder.encode(s).length;

  let body = "";
  let included = 0;
  for (const p of input.papers) {
    const block = `\n${paperBlock(input.siteUrl, p)}\n`;
    const omittedCount = input.papers.length - included - 1;
    // 预留一行截断说明的空间, 保证加上说明后仍不超预算。
    const note =
      omittedCount > 0
        ? `\n_${omittedCount} more paper(s) omitted for size._\n`
        : "";
    if (byteLen(head + body + block + note) > input.maxBytes) {
      break;
    }
    body += block;
    included += 1;
  }

  const omitted = input.papers.length - included;
  const footer =
    omitted > 0 ? `\n_${omitted} more paper(s) omitted for size._\n` : "";
  return head + body + footer;
}
