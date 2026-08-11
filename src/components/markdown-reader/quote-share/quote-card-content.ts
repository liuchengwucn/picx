import { m } from "#/paraglide/messages";
import {
  blocksOf,
  type NormalizedBlock,
  type NormalizedSegment,
  normalizeBlock,
  type QuoteAnchor,
} from "./quote-anchor";

/**
 * 选中部分的字符上限。绝大多数论文段落都落在这个量级以内，也就是「用户选多少、卡片
 * 收多少」；真超了才截断，靠末尾省略号 + 卡片底部提示 + 深链兜底。
 */
const MAX_QUOTE = 2000;
/** 前后文各自的字符上限 */
const MAX_CONTEXT = 120;
/**
 * 为了断在句/词边界，最多允许比硬上限少收这么多字符；够不着就宁可硬截。
 *
 * 不能写成「保住上限的百分之多少」：那样的容忍度会随上限一起放大，MAX_QUOTE 抬到
 * 2000 之后就意味着可以为了一个句号白扔一千字。收口浪费本就该是个绝对量。
 */
const BOUNDARY_SLACK = 160;

/** 收口时允许放弃的字符数：窗口很小时（补前后文）按半窗算，避免 slack 反超窗口本身 */
function slackOf(max: number): number {
  return Math.min(BOUNDARY_SLACK, max * 0.5);
}

export const MARK_CLASS = "quote-card-mark";
export const MUTED_CLASS = "quote-card-muted";
const ELLIPSIS = "…";

export interface CardContent {
  /** 已打好标记、裁剪完的块克隆，按顺序渲染进卡片正文 */
  blocks: HTMLElement[];
  /**
   * 卡片头部副标题，**已格式化好、已本地化**：markdown 侧是 `§ 章节名`，PDF 侧是
   * 本地化的页码。格式化放在生产侧而不是 QuoteCard 的 JSX 里，两种来源才能共用同一个
   * 位置；刻意不做成 `{kind:"section"|"page"}` 的联合，否则 QuoteCard 得 switch 一遍
   * 再吐出同样这两个字符串，等于把决定又推回 JSX。
   */
  subtitle: string | null;
  truncated: boolean;
}

/** 从 from 起向后不超过 max 个字符，尽量断在句末或词边界 */
function clampForward(text: string, from: number, max: number): number {
  const hard = Math.min(text.length, from + max);
  if (hard >= text.length) {
    return text.length;
  }
  const slice = text.slice(from, hard);
  // hard < text.length 时 hard 必然就是 from + max，所以 slice.length === max
  const minKeep = slice.length - slackOf(max);
  const sentence = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf("。"),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("！"),
    slice.lastIndexOf("?"),
    slice.lastIndexOf("？"),
  );
  if (sentence >= minKeep) {
    return from + sentence + 1;
  }
  const space = slice.lastIndexOf(" ");
  if (space >= minKeep) {
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
  if (boundary >= 0 && boundary <= slackOf(max)) {
    return hard + boundary + 1;
  }
  return hard;
}

/**
 * 把偏移吸附出 synthetic（KaTeX 折算）段的内部。
 *
 * clampForward/clampBackward 是纯字符串算术、不认识段边界，切点可能落在 `$...$` 中间；
 * 而 wrapRange 对 synthetic 段只能整体包，切点落在里面时同一个公式会先后被压灰和高亮
 * 各包一次，渲染出一个又灰又高亮的公式。吸附到边界即可根治。
 *
 * 用户选区自身的端点不需要吸附：normalizeBlock 解析落在 .katex 内部的 DOM 点时已经
 * 收敛到公式起点，所以 anchor 的偏移天然就在边界上。
 */
function snapOutOfSynthetic(
  segments: NormalizedSegment[],
  offset: number,
  direction: "forward" | "backward",
): number {
  for (const seg of segments) {
    if (!seg.synthetic) {
      continue;
    }
    const end = seg.start + seg.length;
    if (offset > seg.start && offset < end) {
      return direction === "forward" ? end : seg.start;
    }
  }
  return offset;
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

/** 空壳里也要保留的元素：它们本来就没有文本内容，删了会改变排版语义 */
const KEEP_EMPTY = new Set(["BR", "HR"]);

/**
 * 裁剪前就已经没有文本的元素。pruneEmptyShells 只该清理「被 trimOutside 裁空的」外壳，
 * 源文档里本来就空的元素（论文对比表里故意留白的单元格）删掉会让整行少一列、跟其他行错位。
 */
function snapshotAlreadyEmpty(block: HTMLElement): Set<Element> {
  const empty = new Set<Element>();
  for (const el of block.querySelectorAll("*")) {
    if (!el.textContent?.trim()) {
      empty.add(el);
    }
  }
  return empty;
}

/**
 * 删掉裁剪后彻底空掉的元素外壳。trimOutside 只删文本节点，留下的空 <li> 在列表里
 * 仍会渲染出一个孤零零的项目符号。自底向上删（querySelectorAll 是文档序，反过来遍历
 * 即最深的先处理），好让「子节点删空后父节点也空了」一次收敛。
 */
function pruneEmptyShells(
  block: HTMLElement,
  alreadyEmpty: Set<Element>,
): void {
  const nodes = Array.from(block.querySelectorAll("*")).reverse();
  for (const el of nodes) {
    if (KEEP_EMPTY.has(el.tagName)) {
      continue;
    }
    // 公式与图片没有文本内容但必须留下
    if (el.querySelector("img, .katex") || el.classList.contains("katex")) {
      continue;
    }
    if (el.textContent?.trim()) {
      continue;
    }
    if (alreadyEmpty.has(el)) {
      continue;
    }
    el.remove();
  }
}

/** 内容模型只允许 <li> 的容器：省略号不能作为它们的直接子节点 */
const LIST_TAGS = new Set(["UL", "OL"]);

/**
 * 省略号的落点。列表容器的直接子节点只能是 <li>，裸文本节点虽然浏览器容忍，但会被
 * 开成一个匿名块，在卡片上表现为一个没有项目符号的孤立「…」独占一行。
 */
function ellipsisHost(block: HTMLElement, at: "start" | "end"): Element {
  if (!LIST_TAGS.has(block.tagName)) {
    return block;
  }
  const item =
    at === "start" ? block.firstElementChild : block.lastElementChild;
  return item ?? block;
}

function prependEllipsis(block: HTMLElement): void {
  const host = ellipsisHost(block, "start");
  host.insertBefore(document.createTextNode(ELLIPSIS), host.firstChild);
}

function appendEllipsis(block: HTMLElement): void {
  const host = ellipsisHost(block, "end");
  host.appendChild(document.createTextNode(ELLIPSIS));
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

  // 留住整个 NormalizedBlock（而不只是 text）：截断/前后文的切点算出来后要吸附出
  // synthetic 段的边界，吸附需要 segments。
  const nbs: NormalizedBlock[] = [];
  for (let i = anchor.startBlock; i <= anchor.endBlock; i += 1) {
    nbs.push(normalizeBlock(blocks[i]));
  }

  // 1) 引文上限：逐块累计，超预算的那一块收口，其后的块整个不要
  let budget = MAX_QUOTE;
  let lastBlock = anchor.endBlock;
  let lastQuoteEnd = anchor.endOffset;
  let truncated = false;

  for (let i = anchor.startBlock; i <= anchor.endBlock; i += 1) {
    const nb = nbs[i - anchor.startBlock];
    const text = nb.text;
    const from = i === anchor.startBlock ? anchor.startOffset : 0;
    const to = i === anchor.endBlock ? anchor.endOffset : text.length;
    if (to - from <= budget) {
      budget -= to - from;
      continue;
    }
    lastBlock = i;
    // 收口切点是纯字符串算术算出来的，可能落进公式内部——往回吸附到公式起点，
    // 既避免公式被半个包，也不会撑破 MAX_QUOTE 预算。
    lastQuoteEnd = snapOutOfSynthetic(
      nb.segments,
      clampForward(text, from, budget),
      "backward",
    );
    truncated = true;
    break;
  }

  // 2) 两端补前后文。已截断时尾部不再补：那段文本本就在选区之内，压灰渲染等于告诉
  //    读者「这不是你选的」，而末尾省略号与卡片底部的截断提示已经交代了后面还有。
  const startNb = nbs[0];
  const endNb = nbs[lastBlock - anchor.startBlock];
  const leadStart = snapOutOfSynthetic(
    startNb.segments,
    clampBackward(startNb.text, anchor.startOffset, MAX_CONTEXT),
    "backward",
  );
  const tailEnd = truncated
    ? lastQuoteEnd
    : snapOutOfSynthetic(
        endNb.segments,
        clampForward(endNb.text, lastQuoteEnd, MAX_CONTEXT),
        "forward",
      );

  // 3) 逐块克隆 → 打标记 → 裁剪 → 省略号
  const out: HTMLElement[] = [];
  for (let i = anchor.startBlock; i <= lastBlock; i += 1) {
    const text = nbs[i - anchor.startBlock].text;
    // 贡献不了规范化文本的块（插图、纯装饰元素）整块不要：normalizeBlock 不认它们，
    // trimOutside 也就管不着，留下来只会把图注这类文字原样漏进卡片。
    if (!text) {
      continue;
    }
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
    // 裁剪前先记下源文档里本来就空的元素，trimOutside 之后就分不清是谁裁空的了
    const alreadyEmpty = snapshotAlreadyEmpty(clone);
    trimOutside(clone, keepFrom, keepTo);
    pruneEmptyShells(clone, alreadyEmpty);

    if (i === anchor.startBlock && keepFrom > 0) {
      prependEllipsis(clone);
    }
    if (i === lastBlock && keepTo < text.length) {
      appendEllipsis(clone);
    }
    out.push(clone);
  }

  const heading = sectionOf(blocks, anchor.startBlock);
  return {
    blocks: out,
    subtitle: heading ? `§ ${heading}` : null,
    truncated,
  };
}

/**
 * 纯文本卡片正文。PDF 文本层上选中的东西没有块结构、没有锚点，只有一段文字，所以
 * 合成一个 <p> 交给 QuoteCard——它消费的就是 HTMLElement[]，整套预览/截图/二维码
 * 因此原样复用，不需要第二种卡片。
 *
 * 上限沿用 MAX_QUOTE：卡片高度的观感与 markdown 侧一致，也不多引入一个要调的常数。
 * 因此传进来的文本必须是**未按长度裁过的**原始选区（折过空白即可），否则这里量不出
 * 真实长度，`truncated` 会恒为 false、卡片底部的截断提示随之静默消失。
 * 全段都是引文，所以整段包进高亮里（markdown 侧是「引文高亮 + 压灰前后文」，PDF 侧
 * 没有可靠的前后文可取）。
 *
 * 副标题在这里就地本地化而不是由调用方传字符串：卡片头部的文案（`§`、页码、截断提示）
 * 归拥有卡片的这一层管，散到 1500 行的路由文件里就没人找得到了。
 */
export function plainCardContent(
  text: string,
  page: number,
): CardContent | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const truncated = trimmed.length > MAX_QUOTE;
  const body = truncated
    ? `${trimmed.slice(0, MAX_QUOTE).trimEnd()}${ELLIPSIS}`
    : trimmed;
  // 刻意不加 MARK_CLASS 高亮：markdown 侧那个金色底的意思是「这一段才是引文，周围是
  // 前后文」，而这里整张卡片正文就是引文，高亮 100% 覆盖等于不承载任何信息，只剩重量
  // ——1900 字的选区实测是一整块金色板砖（浏览器验证时截图对比过短/长两种引文）。
  // 「这是引文」已经由弹窗标题、卡片头部的标题+页码、以及二维码那一行交代清楚了。
  const block = document.createElement("p");
  block.textContent = body;
  return {
    blocks: [block],
    subtitle: m.quote_card_page({ page: String(page) }),
    truncated,
  };
}
