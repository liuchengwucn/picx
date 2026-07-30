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

interface LlmsTxtStory {
  shortId: string;
  title: string;
  summary: string;
}

// llms.txt 里每条新闻摘要截断到这个字符数, 保持索引平铺、不喧宾夺主。
const STORY_SUMMARY_TRUNCATE_LENGTH = 150;

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength
    ? `${text.slice(0, maxLength).trimEnd()}...`
    : text;
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
    `- [AI News](${siteUrl}/news): Hourly-aggregated frontier AI/LLM news stories.`,
    `- [About](${siteUrl}/about): What PicX is and how it works.`,
  ].join("\n");
}

export function buildLlmsTxt(input: {
  siteUrl: string;
  papers: LlmsTxtPaper[];
  stories?: LlmsTxtStory[];
}): string {
  const lines = [header(input.siteUrl), "", "## Papers", ""];
  for (const p of input.papers) {
    const link = `- [${p.title}](${input.siteUrl}/p/${p.shortId}.md)`;
    lines.push(p.tldr ? `${link}: ${p.tldr}` : link);
  }
  if (input.stories && input.stories.length > 0) {
    lines.push("", "## Latest AI News", "");
    for (const s of input.stories) {
      const link = `- [${s.title}](${input.siteUrl}/news/${s.shortId})`;
      const summary = truncate(s.summary, STORY_SUMMARY_TRUNCATE_LENGTH);
      lines.push(summary ? `${link}: ${summary}` : link);
    }
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

function storyBlock(siteUrl: string, s: LlmsTxtStory): string {
  return [
    `## ${s.title}`,
    "",
    `- **Permalink:** ${siteUrl}/news/${s.shortId}`,
    "",
    s.summary,
  ].join("\n");
}

export function buildLlmsFullTxt(input: {
  siteUrl: string;
  papers: LlmsFullPaper[];
  stories?: LlmsTxtStory[];
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
  body += footer;

  // 新闻 story 作为独立小节追加在论文之后, 复用同一套字节预算机制: 逐条累加、
  // 超预算就整条丢弃并在小节末尾注明——预算是相对 head+body 之后剩余空间算的,
  // 所以论文占满预算时这个小节干脆不出现(不会输出孤立的空标题)。
  const stories = input.stories ?? [];
  let storiesSection = "";
  if (stories.length > 0) {
    const sectionHeading = "\n## Latest AI News\n";
    let storiesBody = "";
    let storiesIncluded = 0;
    for (const s of stories) {
      const block = `\n${storyBlock(input.siteUrl, s)}\n`;
      const omittedCount = stories.length - storiesIncluded - 1;
      const note =
        omittedCount > 0
          ? `\n_${omittedCount} more stor${omittedCount === 1 ? "y" : "ies"} omitted for size._\n`
          : "";
      if (
        byteLen(head + body + sectionHeading + storiesBody + block + note) >
        input.maxBytes
      ) {
        break;
      }
      storiesBody += block;
      storiesIncluded += 1;
    }
    if (storiesIncluded > 0) {
      const storiesOmitted = stories.length - storiesIncluded;
      const storiesFooter =
        storiesOmitted > 0
          ? `\n_${storiesOmitted} more stor${storiesOmitted === 1 ? "y" : "ies"} omitted for size._\n`
          : "";
      storiesSection = sectionHeading + storiesBody + storiesFooter;
    }
  }

  return head + body + storiesSection;
}
