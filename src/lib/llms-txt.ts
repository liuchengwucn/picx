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
  "An all-in-one workstation for academic papers: track AI news, discover papers with an AI assistant, read full text, discuss with AI, and generate visual whiteboard summaries.";

const SITE_INTRO =
  "PicX helps knowledge workers go from discovery to deep reading: a live AI news feed, AI-assisted paper discovery, a full-text reader with AI discussion, and one-glance visual whiteboards. Each paper links to a clean Markdown view intended for AI consumption.";

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

interface LlmsTxtDigest {
  directionSlug: string;
  issueNumber: number;
  title: string;
}

interface LlmsFullDigest extends LlmsTxtDigest {
  content: string;
}

// llms.txt 里每条新闻摘要截断到这个字符数, 保持索引平铺、不喧宾夺主。
const STORY_SUMMARY_TRUNCATE_LENGTH = 150;

// 标题/摘要来自 AI 生成的用户可见文本，可能含换行, 会破坏逐行的 markdown 结构
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// 链接文字还需转义反斜杠与方括号 (单趟替换, 避免二次转义), 否则 "]" 会提前终结 markdown 链接
function linkText(text: string): string {
  return collapseWhitespace(text).replace(/[\\[\]]/g, "\\$&");
}

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
    // 「updated daily」在周刊重构后就不成立了: /gallery 是每周一期的合刊落地页,
    // 逐日更新的那条扁平论文流搬到了 /gallery/archive。给爬虫报错的更新节奏比不报
    // 更糟 —— 它会按日回抓一个一周才变一次的页面。
    `- [Weekly Gallery](${siteUrl}/gallery): Weekly edition of deep-dive digests across all tracked research directions.`,
    `- [Archive](${siteUrl}/gallery/archive): Searchable archive of every paper summary on the site, refreshed as new papers land.`,
    `- [AI News](${siteUrl}/news): Hourly-aggregated frontier AI/LLM news stories.`,
  ].join("\n");
}

function digestUrl(siteUrl: string, d: LlmsTxtDigest): string {
  return `${siteUrl}/gallery/d/${d.directionSlug}/${d.issueNumber}`;
}

export function buildLlmsTxt(input: {
  siteUrl: string;
  papers: LlmsTxtPaper[];
  digests?: LlmsTxtDigest[];
  stories?: LlmsTxtStory[];
}): string {
  const lines = [header(input.siteUrl), "", "## Papers", ""];
  for (const p of input.papers) {
    const link = `- [${linkText(p.title)}](${input.siteUrl}/p/${p.shortId}.md)`;
    lines.push(p.tldr ? `${link}: ${collapseWhitespace(p.tldr)}` : link);
  }
  if (input.digests && input.digests.length > 0) {
    lines.push("", "## Research Direction Digests", "");
    for (const d of input.digests) {
      lines.push(`- [${linkText(d.title)}](${digestUrl(input.siteUrl, d)})`);
    }
  }
  if (input.stories && input.stories.length > 0) {
    lines.push("", "## Latest AI News", "");
    for (const s of input.stories) {
      const link = `- [${linkText(s.title)}](${input.siteUrl}/news/${s.shortId})`;
      const summary = truncate(
        collapseWhitespace(s.summary),
        STORY_SUMMARY_TRUNCATE_LENGTH,
      );
      lines.push(summary ? `${link}: ${summary}` : link);
    }
  }
  return `${lines.join("\n")}\n`;
}

function paperBlock(siteUrl: string, p: LlmsFullPaper): string {
  // 标题里的换行会截断 heading, 折叠成单行; 正文 summary 保持原始 markdown
  const lines = [`## ${collapseWhitespace(p.title)}`];
  // tldr 折叠成单行, 否则换行会逃出 blockquote
  if (p.tldr) lines.push("", `> ${collapseWhitespace(p.tldr)}`);
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

function digestBlock(siteUrl: string, d: LlmsFullDigest): string {
  return [
    `## ${collapseWhitespace(d.title)}`,
    "",
    `- **Permalink:** ${digestUrl(siteUrl, d)}`,
    "",
    d.content,
  ].join("\n");
}

function storyBlock(siteUrl: string, s: LlmsTxtStory): string {
  return [
    `## ${collapseWhitespace(s.title)}`,
    "",
    `- **Permalink:** ${siteUrl}/news/${s.shortId}`,
    "",
    s.summary,
  ].join("\n");
}

/**
 * 按字节预算逐条追加一个小节: 超预算的条目整条丢弃并在小节末尾注明 (不静默截断)。
 * prefix 是本小节之前已确定要输出的内容——预算按剩余空间算, 所以前面的小节占满
 * 预算时本小节干脆整个不出现 (不会留下孤立的空标题)。
 */
function budgetedSection<T>(input: {
  prefix: string;
  maxBytes: number;
  heading: string;
  items: T[];
  renderBlock: (item: T) => string;
  omittedNote: (count: number) => string;
}): string {
  if (input.items.length === 0) return "";
  const encoder = new TextEncoder();
  let body = "";
  let included = 0;
  for (const item of input.items) {
    const block = `\n${input.renderBlock(item)}\n`;
    const omittedCount = input.items.length - included - 1;
    // 预留一行截断说明的空间, 保证加上说明后仍不超预算。
    const note = omittedCount > 0 ? input.omittedNote(omittedCount) : "";
    if (
      encoder.encode(input.prefix + input.heading + body + block + note)
        .length > input.maxBytes
    ) {
      break;
    }
    body += block;
    included += 1;
  }
  if (included === 0) return "";
  const omitted = input.items.length - included;
  return input.heading + body + (omitted > 0 ? input.omittedNote(omitted) : "");
}

export function buildLlmsFullTxt(input: {
  siteUrl: string;
  papers: LlmsFullPaper[];
  digests?: LlmsFullDigest[];
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

  // 简报期与新闻 story 各自作为独立小节追加在论文之后, 复用同一套字节预算机制。
  // 简报排在新闻之前: 它是站点自产的策展内容、条数少, 挤掉的风险比新闻更该避免。
  const digestsSection = budgetedSection({
    prefix: head + body,
    maxBytes: input.maxBytes,
    heading: "\n## Research Direction Digests\n",
    items: input.digests ?? [],
    renderBlock: (d) => digestBlock(input.siteUrl, d),
    omittedNote: (n) => `\n_${n} more digest(s) omitted for size._\n`,
  });

  const storiesSection = budgetedSection({
    prefix: head + body + digestsSection,
    maxBytes: input.maxBytes,
    heading: "\n## Latest AI News\n",
    items: input.stories ?? [],
    renderBlock: (s) => storyBlock(input.siteUrl, s),
    omittedNote: (n) =>
      `\n_${n} more stor${n === 1 ? "y" : "ies"} omitted for size._\n`,
  });

  return head + body + digestsSection + storiesSection;
}
