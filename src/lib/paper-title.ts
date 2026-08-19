/**
 * 论文标题的清洗与来源仲裁。
 *
 * 解析管线拿到的标题有两个来源，都会带排版噪音：
 *   - MinerU：产物 markdown 的一级标题（mineru-zip 的 extractTitle）。MinerU 会把
 *     小型大写字母误判成下标输出成 `Th<sub>e</sub>`，并把 `$` 转义成 `\$`。
 *   - pdfjs 回退：PDF 元数据 Title，偶尔是 `Microsoft Word - xxx.docx` 这种垃圾。
 * 而 arXiv 来源的论文入库时已带 HF/arXiv API 给的权威标题，不该被上面两者覆盖。
 */

/** 允许剥除的行内排版标签白名单。不用 `<[^>]+>` 是因为标题里 `<1 GB VRAM` 合法。 */
const INLINE_TAG =
  /<\/?(?:sub|sup|i|b|u|em|strong|span|small|tt|code|br|mark)\b[^>]*>/gi;

/** `<sup>2</sup>` / `<sub>2</sub>` 里的纯数字转 Unicode 上下标，保住语义。 */
const SUP_DIGITS = /<sup>\s*([0-9]+)\s*<\/sup>/gi;
const SUB_DIGITS = /<sub>\s*([0-9]+)\s*<\/sub>/gi;

const SUPERSCRIPT_DIGIT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const SUBSCRIPT_DIGIT = "₀₁₂₃₄₅₆₇₈₉";

const HTML_ENTITY: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

/** LaTeX 里为了让字面量不被解释而加的反斜杠，去掉后就是原字符。 */
const LATEX_ESCAPE = /\\([$&%#_{}])/g;

/** `$-$` 这类只包了一个运算符的行内数学，还原成裸符号（arXiv 标题里常见）。 */
const TRIVIAL_MATH = /\$\s*([-+=<>*/])\s*\$/g;

const toUnicodeDigits = (digits: string, table: string): string =>
  [...digits].map((d) => table[Number(d)]).join("");

/**
 * 无损清洗：只还原被排版层加进来的东西（HTML 标签 / 实体 / LaTeX 转义 / 空白），
 * 不改写文字本身。`$\mu \mathbf{P}$` 这类真 LaTeX 数学保持原样——把它还原成
 * 人读的形式需要符号表，猜错的代价比留着难看更高，存量交给 arXiv 权威标题回填。
 */
export function cleanExtractedTitle(raw: string): string {
  let out = raw;

  out = out.replace(SUP_DIGITS, (_, d: string) =>
    toUnicodeDigits(d, SUPERSCRIPT_DIGIT),
  );
  out = out.replace(SUB_DIGITS, (_, d: string) =>
    toUnicodeDigits(d, SUBSCRIPT_DIGIT),
  );
  // 非数字的上下标（`Th<sub>e</sub>` 这种误判）只剥标签，内容原样保留
  out = out.replace(INLINE_TAG, "");

  for (const [entity, char] of Object.entries(HTML_ENTITY)) {
    out = out.replaceAll(entity, char);
  }
  out = out.replace(TRIVIAL_MATH, "$1");
  out = out.replace(LATEX_ESCAPE, "$1");

  // 换行/制表/连续空格折叠成单空格。MinerU 丢符号时会留下一串空格
  // （`Roadmap     User Guide` 原文是 `&`），折叠后至少不像排版事故。
  return out.replace(/\s+/g, " ").trim();
}

/** 兜底标题的形态：文件名、arXiv 编号、URL、`Paper <8位id>`。 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^https?:\/\//i,
  /^arxiv:\s*\d{4}\.\d{4,5}(v\d+)?$/i,
  /^\d{4}\.\d{4,5}(v\d+)?$/,
  /^paper [0-9a-f]{8}$/i,
  /\.(pdf|docx?|tex)$/i,
];

/**
 * 判断入库标题是不是「没有真标题」的占位。占位标题没有权威性，
 * 该让位给解析出来的标题。
 */
export function isPlaceholderTitle(title: string | null | undefined): boolean {
  const t = title?.trim() ?? "";
  if (t.length === 0) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}

export interface ResolveTitleInput {
  sourceType: "upload" | "arxiv";
  /** 入库时写下的标题：arxiv 来源来自 HF/arXiv API，upload 来源是文件名。 */
  existingTitle: string | null | undefined;
  /** 解析管线抽出的标题（MinerU 一级标题 / PDF 元数据 / LLM 提取），未清洗。 */
  extractedTitle: string | null | undefined;
}

export interface ResolvedTitle {
  title: string;
  /** 供日志区分走了哪条分支。 */
  source: "existing" | "extracted";
}

/**
 * 仲裁最终标题。arXiv 来源的权威标题优先——解析结果只在入库标题是占位时才顶上，
 * 因为 OCR 会把干净标题改坏（丢副标题、错字、误插下标），而 API 标题不会。
 */
export function resolveFinalTitle(input: ResolveTitleInput): ResolvedTitle {
  const existing = input.existingTitle?.trim()
    ? cleanExtractedTitle(input.existingTitle)
    : "";
  const extracted = input.extractedTitle?.trim()
    ? cleanExtractedTitle(input.extractedTitle)
    : "";

  const existingUsable =
    existing.length > 0 &&
    input.sourceType === "arxiv" &&
    !isPlaceholderTitle(existing);

  if (existingUsable) return { title: existing, source: "existing" };
  if (extracted.length > 0) return { title: extracted, source: "extracted" };
  // 解析没给出标题时保留原值，哪怕它只是文件名——总好过写空标题
  return { title: existing, source: "existing" };
}
