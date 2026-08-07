/**
 * MinerU U+FFFD（�）损坏字符的对齐回补（与 mineru-clean.ts 平级的独立清洗）。
 *
 * 实测（2026-08）MinerU 对部分 LaTeX 字体会把 astral 数学字符
 * （如 𝑘 U+1D458，多在 U+1D400–U+1D7FF 区）损坏为 U+FFFD，信息已丢，
 * 无法从 markdown 自身恢复。但原始 PDF 的文本层是干净的（pdfjs-serverless
 * 抽取实测零 FFFD），因此可以把 markdown 里每处 � 按前后文对齐到文本层，
 * 从中取回丢失的字符。
 *
 * 算法概要：
 * 1. 把 markdown 中连续的 �（run）逐个处理，取 run 前后各一段上下文；
 * 2. 双侧做同一套归一化，投影到可比较空间：丢弃 markdown/LaTeX 语法字符
 *    与全部空白；把数学字母数字符号（U+1D400–U+1D7FF 及字母式符号区的
 *    ℎ/ℋ 等）折叠为基础字母——markdown 里写作 LaTeX（$r$、\mathcal{H}），
 *    PDF 文本层却是真实字形（𝑟、ℋ），不折叠就对不上；markdown 侧另外
 *    剥掉 LaTeX 命令名（\mathcal 等）。刻意不用 NFKC——它是全局折叠，
 *    会把要回补进 markdown 的 𝑘 折叠成 k，且波及无关字符；
 * 3. 在归一化 PDF 文本中找 prefix+suffix 的所有匹配位，取两者之间的
 *    gap（从原始文本层取回）作为丢失内容；任何歧义（不同匹配位给出
 *    不同 gap）即放弃；
 * 4. 安全闸：gap 为 1–8 个 code point 且全部非 ASCII——丢失的只会是
 *    特殊字符，含 ASCII 的 gap 一律视为错位注入拒绝。gap 只取归一化后
 *    仍存在的字符（语法字符/空白按定义不可比较、不注入），因此错位到
 *    真实 ASCII 内容上的 gap 必被该闸拦截。
 *
 * 纯函数、确定性、幂等；宁可漏补，绝不错改。
 */

export interface FffdRepairResult {
  /** 回补后的 markdown（除 � 片段外与输入逐字节一致）。 */
  markdown: string;
  /** 输入中 � 连续段（run）总数。 */
  total: number;
  /** 成功回补的 run 数。 */
  repaired: number;
}

const FFFD = "�";
const FFFD_RUN_RE = /�+/g;

/**
 * 归一化时丢弃的字符：全部空白 + markdown/LaTeX 语法字符。
 * 只丢 ASCII——这样若某匹配 gap 的原文里混入了被丢字符，它必是 ASCII，
 * 会被安全闸拒绝，不存在「把被丢字符重新注入」的错改路径。
 * `-` 也丢：PDF 文本层的断行连字与 markdown 的合词形态经常不一致。
 */
const DROPPED_CHARS = new Set("$\\{}*_#`[]()<>|^~&%\"'-");

/**
 * 字母式符号区（U+2100–U+214F）里被数学斜体/花体字母表借用的字符，
 * 折叠到基础字母（如 ℎ 是数学斜体 h 在 U+1D455 处的「洞」）。
 */
const LETTERLIKE_FOLD = new Map(
  Object.entries({
    ℎ: "h",
    ℬ: "B",
    ℰ: "E",
    ℱ: "F",
    ℋ: "H",
    ℐ: "I",
    ℒ: "L",
    ℳ: "M",
    ℛ: "R",
    ℯ: "e",
    ℊ: "g",
    ℴ: "o",
    ℭ: "C",
    ℌ: "H",
    ℑ: "I",
    ℜ: "R",
    ℨ: "Z",
    ℂ: "C",
    ℍ: "H",
    ℕ: "N",
    ℙ: "P",
    ℚ: "Q",
    ℝ: "R",
    ℤ: "Z",
    ℓ: "l",
  }),
);

/** U+1D6A8 起希腊字母块的固定布局（每块 58 个：25 个大写（24 字母 + ϴ）、∇、25 小写含 ς、7 变体）。 */
const MATH_GREEK_LAYOUT =
  "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡϴΣΤΥΦΧΨΩ∇αβγδεζηθικλμνξοπρςστυφχψω∂ϵϑϰϕϱϖ";

/** 把数学字母数字符号折叠为基础字母/数字（仅用于比较空间，不改动输出）。 */
function foldMathChar(ch: string): string {
  const folded = LETTERLIKE_FOLD.get(ch);
  if (folded !== undefined) {
    return folded;
  }
  const cp = ch.codePointAt(0) as number;
  if (cp < 0x1d400 || cp > 0x1d7ff) {
    return ch;
  }
  if (cp <= 0x1d6a3) {
    // 拉丁字母区：每 52 个一组（26 大写 + 26 小写）。
    const n = (cp - 0x1d400) % 52;
    return String.fromCharCode(n < 26 ? 0x41 + n : 0x61 + n - 26);
  }
  if (cp === 0x1d6a4 || cp === 0x1d6a5) {
    return cp === 0x1d6a4 ? "i" : "j"; // 无点 ı/ȷ
  }
  // 上界止于最后一个希腊块末尾（U+1D7C9 ϖ）：U+1D7CA/1D7CB 是
  // BOLD DIGAMMA 𝟊/𝟋，不属于按 58 分块的布局，不折叠。
  if (cp >= 0x1d6a8 && cp <= 0x1d7c9) {
    return MATH_GREEK_LAYOUT[(cp - 0x1d6a8) % 58];
  }
  if (cp >= 0x1d7ce) {
    return String.fromCharCode(0x30 + ((cp - 0x1d7ce) % 10));
  }
  return ch; // 区内保留码位
}

function isDroppedChar(ch: string): boolean {
  return DROPPED_CHARS.has(ch) || /\s/.test(ch);
}

/** 上下文归一化后的目标长度（UTF-16 单元）。 */
const CONTEXT_TARGET = 12;
/** 上下文归一化后的最小长度，不足即放弃该侧（文首/文尾/被相邻 � 截断）。 */
const CONTEXT_MIN = 8;
/** 上下文原始扫描窗口（UTF-16 单元）。 */
const CONTEXT_RAW_CAP = 64;
/** prefix 与 suffix 之间允许的归一化 gap 上限（UTF-16 单元）。 */
const GAP_MAX_UNITS = 16;
/** gap 去空白后允许的 code point 数范围。 */
const GAP_MIN_CODEPOINTS = 1;
const GAP_MAX_CODEPOINTS = 8;

/** markdown 侧的 LaTeX 命令名（\mathcal、\tag 等），比较前整体剥掉。 */
const LATEX_COMMAND_RE = /\\[a-zA-Z]+/g;

interface NormalizedPdf {
  /** 归一化后的文本（丢语法字符与空白、折叠数学字母，不做其他折叠）。 */
  text: string;
  /** text 每个 UTF-16 单元对应的原始 pdfText 起始索引。 */
  origStart: number[];
  /** text 每个 UTF-16 单元对应的原始 pdfText 结束索引（排他）。 */
  origEnd: number[];
}

/** 归一化 PDF 文本层，并维护归一化位置→原始位置的索引映射。 */
function normalizePdfText(pdfText: string): NormalizedPdf {
  const chunks: string[] = [];
  const origStart: number[] = [];
  const origEnd: number[] = [];
  let i = 0;
  while (i < pdfText.length) {
    const cp = pdfText.codePointAt(i) as number;
    const len = cp > 0xffff ? 2 : 1;
    const ch = pdfText.slice(i, i + len);
    if (!isDroppedChar(ch)) {
      const folded = foldMathChar(ch);
      chunks.push(folded);
      for (let u = 0; u < folded.length; u++) {
        origStart.push(i);
        origEnd.push(i + len);
      }
    }
    i += len;
  }
  return { text: chunks.join(""), origStart, origEnd };
}

/** markdown 上下文归一化：剥 LaTeX 命令名，再逐字符丢弃/折叠。 */
function normalizeMarkdownContext(raw: string): string {
  const stripped = raw.replace(LATEX_COMMAND_RE, "");
  const chunks: string[] = [];
  let i = 0;
  while (i < stripped.length) {
    const cp = stripped.codePointAt(i) as number;
    const len = cp > 0xffff ? 2 : 1;
    const ch = stripped.slice(i, i + len);
    if (!isDroppedChar(ch)) {
      chunks.push(foldMathChar(ch));
    }
    i += len;
  }
  return chunks.join("");
}

/** 截掉边缘残缺的代理对（窗口切分可能切到 astral 字符中间）。 */
function trimLoneSurrogates(s: string): string {
  let out = s;
  const first = out.charCodeAt(0);
  if (first >= 0xdc00 && first <= 0xdfff) {
    out = out.slice(1);
  }
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * 取 run 前的归一化 prefix：向前开原始窗口，遇到另一个 �（未修复，
 * 不能混进匹配串）截断，归一化后取末尾 CONTEXT_TARGET 个单元。
 */
function collectPrefix(markdown: string, start: number): string {
  let raw = markdown.slice(Math.max(0, start - CONTEXT_RAW_CAP), start);
  const lastFffd = raw.lastIndexOf(FFFD);
  if (lastFffd !== -1) {
    raw = raw.slice(lastFffd + 1);
  }
  const norm = normalizeMarkdownContext(trimLoneSurrogates(raw));
  return trimLoneSurrogates(norm.slice(-CONTEXT_TARGET));
}

/** 取 run 后的归一化 suffix，截断规则同 prefix，取开头 CONTEXT_TARGET 个单元。 */
function collectSuffix(markdown: string, end: number): string {
  let raw = markdown.slice(end, end + CONTEXT_RAW_CAP);
  const firstFffd = raw.indexOf(FFFD);
  if (firstFffd !== -1) {
    raw = raw.slice(0, firstFffd);
  }
  const norm = normalizeMarkdownContext(trimLoneSurrogates(raw));
  return trimLoneSurrogates(norm.slice(0, CONTEXT_TARGET));
}

/**
 * 在归一化 PDF 文本中对齐 prefix+suffix，返回唯一确定且通过安全闸的
 * gap 内容；任何拿不准的情况（无匹配、歧义、gap 不合规）返回 null。
 */
function resolveGap(
  normPrefix: string,
  normSuffix: string,
  pdf: NormalizedPdf,
  pdfText: string,
): string | null {
  if (normPrefix.length < CONTEXT_MIN || normSuffix.length < CONTEXT_MIN) {
    return null;
  }
  let gap: string | null = null;
  let from = 0;
  while (true) {
    const p = pdf.text.indexOf(normPrefix, from);
    if (p === -1) {
      break;
    }
    from = p + 1;
    const prefixEnd = p + normPrefix.length;
    const sMax = Math.min(
      prefixEnd + GAP_MAX_UNITS,
      pdf.text.length - normSuffix.length,
    );
    for (let s = prefixEnd; s <= sMax; s++) {
      if (!pdf.text.startsWith(normSuffix, s)) {
        continue;
      }
      // 从原始 PDF 文本逐单元取回 gap：只取归一化后仍存在的字符
      // （被丢弃的语法字符/空白全是 ASCII，本就不该注入 markdown；
      // 若错位到真实 ASCII 内容上，安全闸会拒绝）。折叠后的 astral
      // 字符按原始字符取回，连续单元按起始索引去重。
      let candidate = "";
      let lastStart = -1;
      for (let u = prefixEnd; u < s; u++) {
        if (pdf.origStart[u] !== lastStart) {
          lastStart = pdf.origStart[u];
          candidate += pdfText.slice(pdf.origStart[u], pdf.origEnd[u]);
        }
      }
      if (gap === null) {
        gap = candidate;
      } else if (gap !== candidate) {
        return null; // 歧义：不同匹配位给出不同 gap，放弃。
      }
    }
  }
  if (gap === null) {
    return null;
  }
  const codePoints = [...gap];
  if (
    codePoints.length < GAP_MIN_CODEPOINTS ||
    codePoints.length > GAP_MAX_CODEPOINTS
  ) {
    return null;
  }
  for (const ch of codePoints) {
    const cp = ch.codePointAt(0) as number;
    // 全部必须非 ASCII（丢失的只会是特殊字符），且不能把 � 又补回去。
    if (cp <= 0x7f || cp === 0xfffd) {
      return null;
    }
  }
  return gap;
}

/** 单遍扫描：对快照里的每个 run 尝试回补，返回新文本与计数。 */
function repairPass(
  markdown: string,
  pdf: NormalizedPdf,
  pdfText: string,
): { markdown: string; total: number; repaired: number } {
  let total = 0;
  let repaired = 0;
  const parts: string[] = [];
  let pos = 0;
  for (const m of markdown.matchAll(FFFD_RUN_RE)) {
    total += 1;
    const prefix = collectPrefix(markdown, m.index);
    const suffix = collectSuffix(markdown, m.index + m[0].length);
    const gap = resolveGap(prefix, suffix, pdf, pdfText);
    if (gap !== null) {
      parts.push(markdown.slice(pos, m.index), gap);
      pos = m.index + m[0].length;
      repaired += 1;
    }
  }
  if (repaired === 0) {
    return { markdown, total, repaired: 0 };
  }
  parts.push(markdown.slice(pos));
  return { markdown: parts.join(""), total, repaired };
}

/**
 * 把 markdown 里每处 �（连续段视为一个 run）按上下文对齐到 PDF 文本层，
 * 回补丢失字符。迭代到不动点：先修复的 run 会解除相邻 run 的上下文截断，
 * 让后续遍有机会继续回补；也因此对输出再跑一遍必然零变化（幂等）。
 */
export function repairFffd(
  markdown: string,
  pdfText: string,
): FffdRepairResult {
  // 快路径：无 � 时不做任何扫描分配，直接返回原引用。
  if (!markdown.includes(FFFD)) {
    return { markdown, total: 0, repaired: 0 };
  }
  const pdf = normalizePdfText(pdfText);
  const first = repairPass(markdown, pdf, pdfText);
  const total = first.total;
  let repaired = first.repaired;
  let current = first.markdown;
  // 迭代上限 = 初始 run 数（每遍至少修复一个才继续，必然终止）。
  for (let pass = 1; pass < total; pass++) {
    if (!current.includes(FFFD)) {
      break;
    }
    const next = repairPass(current, pdf, pdfText);
    if (next.repaired === 0) {
      break;
    }
    repaired += next.repaired;
    current = next.markdown;
  }
  return { markdown: current, total, repaired };
}
