import { blocksOf, normalizeBlock, type QuoteAnchor } from "./quote-anchor";

/** 选中部分的字符上限。超出即截断——卡片高度可控，聊天窗口里永远能看清 */
const MAX_QUOTE = 400;
/** 前后文各自的字符上限 */
const MAX_CONTEXT = 120;
/** 收口时至少要保住的比例：句/词边界离硬上限太远就不用它，宁可硬截 */
const BOUNDARY_FLOOR = 0.5;

export const MARK_CLASS = "quote-card-mark";
export const MUTED_CLASS = "quote-card-muted";
const ELLIPSIS = "…";

export interface CardContent {
  /** 已打好标记、裁剪完的块克隆，按顺序渲染进卡片正文 */
  blocks: HTMLElement[];
  /** 章节名：起始块往前最近的 h1/h2/h3，没有则 null */
  section: string | null;
  truncated: boolean;
}

/** 从 from 起向后不超过 max 个字符，尽量断在句末或词边界 */
function clampForward(text: string, from: number, max: number): number {
  const hard = Math.min(text.length, from + max);
  if (hard >= text.length) {
    return text.length;
  }
  const slice = text.slice(from, hard);
  const sentence = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf("。"),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("！"),
    slice.lastIndexOf("?"),
    slice.lastIndexOf("？"),
  );
  if (sentence > max * BOUNDARY_FLOOR) {
    return from + sentence + 1;
  }
  const space = slice.lastIndexOf(" ");
  if (space > max * BOUNDARY_FLOOR) {
    return from + space;
  }
  return hard;
}

/** 从 to 起向前不超过 max 个字符，尽量从句/词边界之后开始 */
function clampBackward(text: string, to: number, max: number): number {
  const hard = Math.max(0, to - max);
  if (hard <= 0) {
    return 0;
  }
  const slice = text.slice(hard, to);
  const boundary = slice.search(/[\s。！？.!?]/);
  if (boundary >= 0 && boundary < max * BOUNDARY_FLOOR) {
    return hard + boundary + 1;
  }
  return hard;
}

/** 在克隆块上把 [from, to) 区间包进 className。从后往前处理，避免 splitText 打乱前面的段。 */
function wrapRange(
  block: HTMLElement,
  from: number,
  to: number,
  className: string,
): void {
  if (from >= to) {
    return;
  }
  const { segments } = normalizeBlock(block);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i];
    const start = Math.max(from, seg.start);
    const end = Math.min(to, seg.start + seg.length);
    if (start >= end) {
      continue;
    }
    const wrap = document.createElement("span");
    wrap.className = className;
    if (seg.synthetic) {
      // 公式是原子，整体包进去
      seg.node.parentNode?.insertBefore(wrap, seg.node);
      wrap.appendChild(seg.node);
      continue;
    }
    const textNode = seg.node as Text;
    // 先切尾再切头：切尾之后 textNode 仍是前半段，头部下标不变
    textNode.splitText(end - seg.start);
    const target =
      start > seg.start ? textNode.splitText(start - seg.start) : textNode;
    target.parentNode?.insertBefore(wrap, target);
    wrap.appendChild(target);
  }
}

/** 删掉克隆块里 [keepFrom, keepTo) 之外的文本。必须在 wrapRange 之后调用。 */
function trimOutside(
  block: HTMLElement,
  keepFrom: number,
  keepTo: number,
): void {
  const { segments } = normalizeBlock(block);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i];
    const segEnd = seg.start + seg.length;
    if (segEnd <= keepFrom || seg.start >= keepTo) {
      seg.node.parentNode?.removeChild(seg.node);
      continue;
    }
    if (seg.synthetic) {
      continue; // 公式无法半切，整体保留
    }
    const textNode = seg.node as Text;
    if (segEnd > keepTo) {
      textNode.deleteData(keepTo - seg.start, segEnd - keepTo);
    }
    if (seg.start < keepFrom) {
      textNode.deleteData(0, keepFrom - seg.start);
    }
  }
}

function prependEllipsis(block: HTMLElement): void {
  block.insertBefore(document.createTextNode(ELLIPSIS), block.firstChild);
}

function appendEllipsis(block: HTMLElement): void {
  block.appendChild(document.createTextNode(ELLIPSIS));
}

/** 起始块往前找最近的 h1/h2/h3 文本 */
function sectionOf(blocks: Element[], startBlock: number): string | null {
  for (let i = startBlock; i >= 0; i -= 1) {
    if (/^H[1-3]$/.test(blocks[i].tagName)) {
      const text = blocks[i].textContent?.trim();
      return text || null;
    }
  }
  return null;
}

/**
 * 卡片正文 = 以选区为中心的上下文窗口，不是机械的整段。
 *
 * 用户可能在 800 字的长段里只选 5 个字，从段首截 400 字会把高亮整个截掉。所以先按
 * 引文上限从起点向后收口，再在两端各补一段压灰的前后文。
 */
export function buildCardContent(
  article: Element,
  anchor: QuoteAnchor,
): CardContent | null {
  const blocks = blocksOf(article);
  if (anchor.startBlock < 0 || anchor.endBlock >= blocks.length) {
    return null;
  }

  const texts: string[] = [];
  for (let i = anchor.startBlock; i <= anchor.endBlock; i += 1) {
    texts.push(normalizeBlock(blocks[i]).text);
  }

  // 1) 引文上限：逐块累计，超预算的那一块收口，其后的块整个不要
  let budget = MAX_QUOTE;
  let lastBlock = anchor.endBlock;
  let lastQuoteEnd = anchor.endOffset;
  let truncated = false;

  for (let i = anchor.startBlock; i <= anchor.endBlock; i += 1) {
    const text = texts[i - anchor.startBlock];
    const from = i === anchor.startBlock ? anchor.startOffset : 0;
    const to = i === anchor.endBlock ? anchor.endOffset : text.length;
    if (to - from <= budget) {
      budget -= to - from;
      continue;
    }
    lastBlock = i;
    lastQuoteEnd = clampForward(text, from, budget);
    truncated = true;
    break;
  }

  // 2) 两端补前后文
  const startText = texts[0];
  const endText = texts[lastBlock - anchor.startBlock];
  const leadStart = clampBackward(startText, anchor.startOffset, MAX_CONTEXT);
  const tailEnd = clampForward(endText, lastQuoteEnd, MAX_CONTEXT);

  // 3) 逐块克隆 → 打标记 → 裁剪 → 省略号
  const out: HTMLElement[] = [];
  for (let i = anchor.startBlock; i <= lastBlock; i += 1) {
    const text = texts[i - anchor.startBlock];
    const clone = blocks[i].cloneNode(true) as HTMLElement;
    // 克隆体不能带走 TOC 的锚点 id —— 卡片是离屏渲染的，重复 id 会让 TOC 跳转
    // 与 scrollspy 命中错误的节点。块自身与后代都要清。
    clone.removeAttribute("id");
    for (const withId of clone.querySelectorAll("[id]")) {
      withId.removeAttribute("id");
    }
    // 插图不参与引用：normalizeBlock 本就跳过 figure/img，它们不在 segments 里，
    // trimOutside 删不掉，不显式摘掉就会整张图漏进卡片。
    for (const media of clone.querySelectorAll("figure, img")) {
      media.remove();
    }

    const quoteFrom = i === anchor.startBlock ? anchor.startOffset : 0;
    const quoteTo = i === lastBlock ? lastQuoteEnd : text.length;
    const keepFrom = i === anchor.startBlock ? leadStart : 0;
    const keepTo = i === lastBlock ? tailEnd : text.length;

    // 顺序不能换：wrapRange 只插 <span>（不改文本），偏移语义在 trimOutside 时仍成立
    wrapRange(clone, keepFrom, quoteFrom, MUTED_CLASS);
    wrapRange(clone, quoteTo, keepTo, MUTED_CLASS);
    wrapRange(clone, quoteFrom, quoteTo, MARK_CLASS);
    trimOutside(clone, keepFrom, keepTo);

    if (i === anchor.startBlock && keepFrom > 0) {
      prependEllipsis(clone);
    }
    if (i === lastBlock && keepTo < text.length) {
      appendEllipsis(clone);
    }
    out.push(clone);
  }

  return {
    blocks: out,
    section: sectionOf(blocks, anchor.startBlock),
    truncated,
  };
}
