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

/** 把选中文本折成单行：排版硬换行与连续空白全部折成单空格。长度策略归调用方。 */
export function collapseSelectionWhitespace(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * 把选中的原始文本整理成可读的一行**并钳到 chat 的引用预算**。两个阅读视图共用：
 *
 * - PDF：输入是 `useSelectionRect` 产出的**渲染文本**，每个视觉行之间一个 `\n`
 *   （pdf.js 的文本层用 `<br>` 分行）。直接丢进 chat 会是一堆断句。
 * - markdown 正文：输入是 `quoteTextOfSelection` 产出的引文文本，公式已折成 `$...$`，
 *   块边界（表格单元格、列表项）同样带换行。
 *
 * 两条路都要把所有空白折成单空格，而且在 markdown 这条路上这是**必需**而非无害：
 * `buildQuoteBlock` 产出的是单行 `> …`，留着换行会让第二行起跳出引用块。
 *
 * 刻意不处理行尾连字符断词（`infer-\nence`）：无法可靠区分排版断词与真实连字符
 * （`state-of-the-art` 恰好断在连字符处时两者完全同形），猜错会造出不存在的词，
 * 宁可折成 `infer- ence` 让人一眼看出是断词。
 *
 * 注意这条取舍成立的前提是上游真的给了换行。曾经上游用的是 `Range.toString()`，它
 * 不认行边界，断词到这儿已经是焊死的 `infer-ence`、跨行词是 `forlarge`——比这里讨论
 * 的情况严格更糟，而且本函数对它完全是 no-op。改动上游前先看
 * `use-selection-rect.ts` 的 `clippedRenderedText`。
 *
 * 只服务 chat 这条路。分享卡片那条路要的是「折空白」而不是「折空白 + 按 chat 预算截」，
 * 走 collapseSelectionWhitespace：这里的默认上限派生自 CHAT_CLIENT_LIMITS，拿它预处理
 * 卡片文本会让卡片的截断策略被 chat 输入框的预算暗中接管，而且尾部省略号是在这里加的，
 * 卡片侧再看长度就已经量不出「用户到底选了多少」，`truncated` 恒为 false——截断提示会
 * 静默消失。
 */
export function normalizePdfSelection(
  raw: string,
  maxChars: number = PDF_QUOTE_MAX_CHARS,
): string {
  const collapsed = collapseSelectionWhitespace(raw);
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
