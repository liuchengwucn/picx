// 正文补抓：无 excerpt 的条目（HN/部分官博 feed 不带正文）经 Jina Reader
// 抓取原文，供下游 filter 打分 / embedding / 聚类精判 / 摘要使用。
// 没有正文时摘要 LLM 只能凭标题用训练期旧知识脑补，是「报旧闻」事故的根因之一
// （见 docs/superpowers/specs/2026-08-10-news-excerpt-enrichment-design.md）。

// excerpt 列的统一存储口径：rss 适配器、hn 适配器、摘要 prompt 的 BODY 截断共用本常量
export const MAX_EXCERPT = 1000;
// 渲染结果比这还短的基本是 cookie 墙/空壳页，视为抓取失败
const MIN_CONTENT_LENGTH = 40;
const FETCH_TIMEOUT_MS = 20_000;

/** Jina Reader 返回 429（免费档 20 RPM，按出口 IP 计）。调用方应停止本轮，下轮再试。 */
export class EnrichRateLimitError extends Error {
  constructor() {
    super("enrich: Jina Reader rate limited (429)");
    this.name = "EnrichRateLimitError";
  }
}

/**
 * Markdown 正文降噪：Reader 输出的页头常是导航链接/logo 图片堆，
 * 图片语法整体丢弃、链接只留文字，再折叠空白，让 1000 字预算尽量装正文。
 * 导航杂质几乎总在正文 h1 之前（实测 arcprize 站头能吃掉 870/1000 字），
 * 有 h1 就从它起截；没有 h1 的页面（Jina 常把标题单独放 Title 字段）保持原样。
 */
export function cleanReadableContent(markdown: string): string {
  const h1 = markdown.search(/^# /m);
  const body = h1 >= 0 ? markdown.slice(h1) : markdown;
  return body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EXCERPT);
}

interface ReaderResponse {
  data?: { content?: string };
}

/**
 * 经 Jina Reader（r.jina.ai）抓取 URL 的可读正文。
 * 成功返回清洗后的正文（≤1000 字）；抓取失败/内容过短返回 null（调用方计失败次数）；
 * 429 抛 {@link EnrichRateLimitError}（不该计入条目失败次数）。
 */
export async function fetchReadable(
  url: string,
  apiKey?: string,
): Promise<string | null> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 429) throw new EnrichRateLimitError();
  if (!response.ok) {
    console.error(`enrich: reader ${response.status} for ${url.slice(0, 120)}`);
    return null;
  }
  const data = (await response.json()) as ReaderResponse;
  const content = cleanReadableContent(data.data?.content ?? "");
  return content.length >= MIN_CONTENT_LENGTH ? content : null;
}
