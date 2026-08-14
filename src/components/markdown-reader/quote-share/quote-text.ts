import { renderedTextOf } from "#/hooks/use-selection-rect";
import { isKatexRoot, latexSourceOf } from "./quote-anchor";

/**
 * 「问这段」的引文文本：走用户实际选中的那段 DOM，而不是锚点。
 *
 * 两个性质缺一不可，而现成的两个函数各只有一半：
 * - 块边界要产生空白：`normalizeBlock` 在块内的后代块边界不插任何分隔符，表格因此
 *   会焊成 `MethodAccOurs91.2`（实测 GFM 表格与 MinerU 裸 HTML 表格都中）。而它的
 *   文本是所有已发出深链的偏移基准与指纹输入，不能改。
 * - KaTeX 折算成 LaTeX 源：`.katex-mathml` 是 clip 视觉隐藏、仍在渲染树里，照常
 *   递归会让同一个公式的文本出现两遍。
 *
 * 走选区还顺带修掉一类错配：锚点是「块序号 + 块内偏移」，端点落在被跳过的
 * FIGURE/IMG/FIGCAPTION 子树里时无法与「端点在 article 外」区分，两者都钳到块首/块尾，
 * 引文会变成用户根本没选的整块文本。
 */
export function quoteTextOfSelection(clippedRange: Range): string {
  return renderedTextOf(clippedRange.cloneContents(), {
    atomicTextOf: (el) => (isKatexRoot(el) ? latexSourceOf(el) : null),
  });
}
