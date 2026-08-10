import { CHAT_CLIENT_LIMITS } from "#/lib/chat-errors";

/**
 * 引用块的字符上限。刻意远低于 chat 输入框的硬上限（maxInputChars=4000）：
 * 引用把输入框顶满的话用户就没地方写问题了，留一半余量给提问本身。
 *
 * 注意 textarea 的 `maxLength` 只拦用户键入、不拦程序化赋值，所以这道自我钳制
 * 是必需的而不是保险——PDF 里一次 Ctrl+A 就是几千字符。
 */
export const PDF_QUOTE_MAX_CHARS = Math.floor(
  CHAT_CLIENT_LIMITS.maxInputChars / 2,
);

/** 引用块与后续提问之间的空行。同时也是光标要落进去的那一行 */
const QUOTE_TRAILER = "\n\n";

/**
 * 把 PDF 文本层选出来的原始文本整理成可读的一行。
 *
 * PDF 的文本层保留的是排版换行（每个视觉行一个换行），直接丢进 chat 会是一堆断句。
 * 这里把所有空白折成单空格。
 *
 * 刻意不处理行尾连字符断词（`repre-\nsentation`）：无法可靠区分排版断词与真实连字符
 * （`state-of-the-art` 恰好断在连字符处时两者完全同形），猜错会造出不存在的词，
 * 宁可保留原样让人一眼看出是断词。
 */
export function normalizePdfSelection(
  raw: string,
  maxChars: number = PDF_QUOTE_MAX_CHARS,
): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars).trimEnd()}…`;
}

/**
 * 包成 markdown 引用块。尾部两个换行让光标落在引用下方的空行，用户直接开始打问题。
 */
export function buildQuoteBlock(text: string): string {
  return `> ${text}${QUOTE_TRAILER}`;
}

/**
 * 把引用块追加到输入框已有内容之后（而不是覆盖：用户可能已经写了半句问题，
 * 也可能想连引两段再一起问）。
 *
 * 单个引用被 PDF_QUOTE_MAX_CHARS 钳到 2000，但「已有内容 + 第二段引用」完全可能
 * 越过服务端的 maxInputChars（两段满额引用就是 4008 > 4000），越过就是发送时一个
 * 413，用户还看不出为什么。所以这里按剩余空间再截一次，且**只截新来的引用**——
 * 用户自己敲进去的字一个都不能动。
 */
export function appendPdfQuote(
  prev: string,
  quote: string,
  maxChars: number = CHAT_CLIENT_LIMITS.maxInputChars,
): string {
  const base = prev.trim() ? `${prev.replace(/\s*$/, "")}${QUOTE_TRAILER}` : "";
  const combined = `${base}${quote}`;
  if (combined.length <= maxChars) return combined;

  const room = maxChars - base.length;
  // `> x` + 结尾空行 = 最短的一个还算有意义的引用块；连它都放不下就别动输入框了，
  // 塞进去一个只剩省略号的引用毫无信息量，反而把用户原文顶到上限。
  const minBlock = `> x${QUOTE_TRAILER}`.length;
  if (room < minBlock) return prev;

  const body = quote.replace(/\n+$/, "");
  const kept = body.slice(0, room - QUOTE_TRAILER.length - 1).trimEnd();
  return `${base}${kept}…${QUOTE_TRAILER}`;
}
