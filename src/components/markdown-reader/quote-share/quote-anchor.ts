/**
 * 选区 ⇄ 锚点串的双向转换 —— 「选中分享」功能的地基。
 *
 * 锚点格式：`q={起块}.{起偏移}-{止块}.{止偏移}.{指纹}`，例 `q=42.13-44.197.a4f2`
 * - 块：<article class="reader-prose"> 的直接元素子节点，按 DOM 顺序从 0 编号
 * - 偏移：块内「规范化文本」的字符下标，左闭右开
 * - 指纹：规范化引文的 FNV-1a 32bit 转 base36
 *
 * 为什么不能直接用 textContent / Selection.toString()：KaTeX 的产物里有两份文本 ——
 * .katex-mathml(MathML，靠 clip 视觉隐藏但仍在渲染树里) 与 .katex-html。两份都会进
 * textContent，含公式的段落偏移必然错位。规范化遍历遇到 .katex 就整体折算成它的
 * LaTeX 源，绝不深入。
 *
 * 块序号的稳定性依赖「原文 markdown 落盘后不可变」(见 paper-reader-view.tsx 的
 * staleTime 注释)。会让老链接失效的是渲染管线变化(新增/调整 rehype 插件导致块拆分
 * 合并)，指纹兜底即为此准备。
 */

export interface NormalizedSegment {
  /** 文本节点；synthetic 为 true 时是被折算成 LaTeX 的 .katex 元素 */
  node: Node;
  /** 该段文本在块规范化文本里的起始下标 */
  start: number;
  /** 该段贡献的字符数 */
  length: number;
  /** true = 由 .katex 折算而来，内部无法按字符切分 */
  synthetic: boolean;
}

export interface NormalizedBlock {
  text: string;
  segments: NormalizedSegment[];
}

export interface DomPoint {
  node: Node;
  offset: number;
}

export interface QuoteAnchor {
  startBlock: number;
  startOffset: number;
  endBlock: number;
  endOffset: number;
  fingerprint: string;
}

/** 插图与图注不参与引用文本：卡片里本就丢弃图片块 */
const SKIPPED_TAGS = new Set(["FIGURE", "IMG", "FIGCAPTION"]);

function latexSourceOf(katex: Element): string {
  const annotation = katex.querySelector(
    'annotation[encoding="application/x-tex"]',
  );
  const tex = annotation?.textContent?.trim();
  return tex ? `$${tex}$` : "";
}

export function blocksOf(article: Element): Element[] {
  return Array.from(article.children);
}

/**
 * 规范化遍历。可选地在同一趟里解析若干 DOM 点的文本偏移 —— 单趟解析比事后用
 * Range.compareBoundaryPoints 可靠得多，那套 API 的 how 参数语义极易搞反。
 *
 * 返回的 resolved 与传入的 points 一一对应；点落在块外(或落在被跳过的子树里)时为 null，
 * 由调用方决定兜底成 0 还是 text.length。
 */
export function normalizeBlock(
  block: Element,
  points: DomPoint[] = [],
): NormalizedBlock & { resolved: (number | null)[] } {
  const segments: NormalizedSegment[] = [];
  const resolved: (number | null)[] = points.map(() => null);
  let text = "";

  const resolveAt = (node: Node, childIndex: number) => {
    points.forEach((p, i) => {
      if (resolved[i] === null && p.node === node && p.offset === childIndex) {
        resolved[i] = text.length;
      }
    });
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = (node as Text).data;
      points.forEach((p, i) => {
        if (resolved[i] === null && p.node === node) {
          resolved[i] = text.length + Math.min(p.offset, data.length);
        }
      });
      if (!data) {
        return;
      }
      segments.push({
        node,
        start: text.length,
        length: data.length,
        synthetic: false,
      });
      text += data;
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    const el = node as Element;
    if (SKIPPED_TAGS.has(el.tagName)) {
      return;
    }

    if (el.classList.contains("katex")) {
      // 选区端点落在公式内部时收敛到公式起点：公式是不可再分的原子
      points.forEach((p, i) => {
        if (resolved[i] === null && (p.node === el || el.contains(p.node))) {
          resolved[i] = text.length;
        }
      });
      const tex = latexSourceOf(el);
      if (tex) {
        segments.push({
          node: el,
          start: text.length,
          length: tex.length,
          synthetic: true,
        });
        text += tex;
      }
      return;
    }

    const children = Array.from(el.childNodes);
    for (let i = 0; i < children.length; i += 1) {
      resolveAt(el, i);
      walk(children[i]);
    }
    resolveAt(el, children.length);
  };

  walk(block);
  return { text, segments, resolved };
}

/** FNV-1a 32bit → base36（最长 7 字符）。只求短且稳定，不求密码学强度。 */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** 取块区间内的规范化引文；区间非法(越界/倒挂)返回 null。跨块用 \n 连接。 */
export function quoteTextBetween(
  blocks: Element[],
  startBlock: number,
  startOffset: number,
  endBlock: number,
  endOffset: number,
): string | null {
  if (startBlock < 0 || endBlock >= blocks.length || endBlock < startBlock) {
    return null;
  }
  const parts: string[] = [];
  for (let i = startBlock; i <= endBlock; i += 1) {
    const { text } = normalizeBlock(blocks[i]);
    const from = i === startBlock ? startOffset : 0;
    const to = i === endBlock ? endOffset : text.length;
    if (from > text.length || to > text.length || from > to) {
      return null;
    }
    parts.push(text.slice(from, to));
  }
  return parts.join("\n");
}

/**
 * 规范化偏移 → DOM 点，用于反向构造 Range。
 *
 * 只接收 block，内部自己 normalize —— 不接收调用方传来的 NormalizedBlock。
 * 之前的签名 (nb, block, offset) 要求 nb 与 block 描述同一个 DOM 元素，但类型层面
 * 完全没有约束，传错了会静默返回错误的 Range；折算成本很低（block 就那么大），
 * 换成单参数不留这个坑。
 */
export function offsetToPoint(block: Element, offset: number): DomPoint | null {
  const nb = normalizeBlock(block);
  for (const seg of nb.segments) {
    if (offset > seg.start + seg.length) {
      continue;
    }
    if (!seg.synthetic) {
      return { node: seg.node, offset: Math.max(0, offset - seg.start) };
    }
    const parent = seg.node.parentNode;
    if (!parent) {
      return null;
    }
    const idx = Array.prototype.indexOf.call(parent.childNodes, seg.node);
    return { node: parent, offset: offset <= seg.start ? idx : idx + 1 };
  }
  const last = nb.segments[nb.segments.length - 1];
  if (!last) {
    // 块完全没有可用文本（比如整块都是被跳过的图片/图注）时的兜底：定位到块自身的起点
    return { node: block, offset: 0 };
  }
  if (!last.synthetic) {
    return { node: last.node, offset: last.length };
  }
  const parent = last.node.parentNode;
  if (!parent) {
    return null;
  }
  return {
    node: parent,
    offset: Array.prototype.indexOf.call(parent.childNodes, last.node) + 1,
  };
}

/** 选区 → 锚点。选区跨出 article 时裁剪到 article 内的部分。 */
export function rangeToAnchor(
  article: Element,
  range: Range,
): QuoteAnchor | null {
  if (range.collapsed) {
    return null;
  }
  const blocks = blocksOf(article);
  const touched: number[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    if (range.intersectsNode(blocks[i])) {
      touched.push(i);
    }
  }
  if (touched.length === 0) {
    return null;
  }

  const startBlock = touched[0];
  const endBlock = touched[touched.length - 1];

  const startNb = normalizeBlock(blocks[startBlock], [
    { node: range.startContainer, offset: range.startOffset },
  ]);
  const endNb = normalizeBlock(blocks[endBlock], [
    { node: range.endContainer, offset: range.endOffset },
  ]);

  // 端点在 article 外时解析不到，裁剪到块的首/尾
  const startOffset = startNb.resolved[0] ?? 0;
  const endOffset = endNb.resolved[0] ?? endNb.text.length;

  if (startBlock === endBlock && endOffset <= startOffset) {
    return null;
  }

  const quote = quoteTextBetween(
    blocks,
    startBlock,
    startOffset,
    endBlock,
    endOffset,
  );
  if (!quote || !quote.trim()) {
    return null;
  }

  return {
    startBlock,
    startOffset,
    endBlock,
    endOffset,
    fingerprint: fingerprint(quote),
  };
}

/**
 * 锚点 → Range。先按块序号直取并用指纹校验；不中则以同样的相对结构(相同偏移、
 * 相同块跨度)逐块平移重试 —— 渲染管线改动导致的是块序整体平移，不是内容变化。
 */
export function anchorToRange(
  article: Element,
  anchor: QuoteAnchor,
): Range | null {
  const blocks = blocksOf(article);
  const span = anchor.endBlock - anchor.startBlock;

  const attempt = (startBlock: number): Range | null => {
    const endBlock = startBlock + span;
    const quote = quoteTextBetween(
      blocks,
      startBlock,
      anchor.startOffset,
      endBlock,
      anchor.endOffset,
    );
    if (quote === null || fingerprint(quote) !== anchor.fingerprint) {
      return null;
    }
    const from = offsetToPoint(blocks[startBlock], anchor.startOffset);
    const to = offsetToPoint(blocks[endBlock], anchor.endOffset);
    if (!from || !to) {
      return null;
    }
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  };

  const direct = attempt(anchor.startBlock);
  if (direct) {
    return direct;
  }
  for (let i = 0; i + span < blocks.length; i += 1) {
    if (i === anchor.startBlock) {
      continue;
    }
    const hit = attempt(i);
    if (hit) {
      return hit;
    }
  }
  return null;
}

export function encodeAnchor(a: QuoteAnchor): string {
  return `q=${a.startBlock}.${a.startOffset}-${a.endBlock}.${a.endOffset}.${a.fingerprint}`;
}

const ANCHOR_RE = /^q=(\d+)\.(\d+)-(\d+)\.(\d+)\.([0-9a-z]+)$/;

/** 解析锚点串；传入的字符串可带前导 `#`。格式非法或区间倒挂返回 null。 */
export function decodeAnchor(raw: string): QuoteAnchor | null {
  const match = ANCHOR_RE.exec(raw.replace(/^#/, ""));
  if (!match) {
    return null;
  }
  const anchor: QuoteAnchor = {
    startBlock: Number(match[1]),
    startOffset: Number(match[2]),
    endBlock: Number(match[3]),
    endOffset: Number(match[4]),
    fingerprint: match[5],
  };
  if (anchor.endBlock < anchor.startBlock) {
    return null;
  }
  if (
    anchor.endBlock === anchor.startBlock &&
    anchor.endOffset <= anchor.startOffset
  ) {
    return null;
  }
  return anchor;
}
