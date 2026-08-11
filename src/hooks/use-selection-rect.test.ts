// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildQuoteBlock, normalizePdfSelection } from "#/lib/pdf-quote";
import { renderedTextOf } from "./use-selection-rect";

/**
 * 造一段 pdf.js 文本层。形状照抄真实 DOM（`/p/SzOCRK?view=pdf` 实测）：`.textLayer`
 * 下是一串 `<span role="presentation">`，每个视觉行之间夹一个
 * `<br role="presentation">`，末尾一个空的 `.endOfContent` div。
 *
 * `<br>` 的 textContent 是空串——这正是 `Range.toString()`（按文本节点拼接）把相邻两
 * 行焊死的直接原因。
 */
function textLayer(html: string): HTMLElement {
  const layer = document.createElement("div");
  layer.className = "textLayer";
  layer.innerHTML = html;
  return layer;
}

/** `Range.toString()` 的等价物：按文本节点直接拼接，不认任何边界 */
function naiveConcat(root: Node): string {
  return root.textContent ?? "";
}

describe("renderedTextOf", () => {
  // 这段是真实回归样本：修复前它产出 `forlarge` 与 `infer-ence`，
  // 每一条跨行引文都带着粘连词被送进 LLM。
  const abstract = textLayer(
    [
      '<span role="presentation">Long-context agentic workflows have emerged as a defining use case for</span>',
      '<br role="presentation">',
      '<span role="presentation">large language models, making attention efficiency critical for both infer-</span>',
      '<br role="presentation">',
      '<span role="presentation">ence speed and serving cost.</span>',
      '<div class="endOfContent"></div>',
    ].join(""),
  );

  it("在 <br> 处断行，跨行的词不再被焊死", () => {
    const text = renderedTextOf(abstract);
    expect(text).toContain("use case for\nlarge language models");
    expect(text).toContain("both infer-\nence speed");
    expect(text).not.toContain("forlarge");
    expect(text).not.toContain("infer-ence");
  });

  it("对照：按文本节点直接拼接（旧行为）确实会焊死", () => {
    const glued = naiveConcat(abstract);
    expect(glued).toContain("forlarge");
    expect(glued).toContain("infer-ence");
  });

  it("同一视觉行上相邻的 span 之间不补任何东西", () => {
    // 上标、字号切换都会让 pdf.js 把一行切成多个 span，它们视觉上是紧挨着的，
    // 凭空插空格会把 `Yushi Bai1†` 拆开
    const layer = textLayer(
      '<span role="presentation">Yushi Bai</span><span role="presentation">1†</span><span role="presentation">, Qian Dong</span>',
    );
    expect(renderedTextOf(layer)).toBe("Yushi Bai1†, Qian Dong");
  });

  it("空的 endOfContent 块不会带进多余文本", () => {
    const layer = textLayer(
      '<span role="presentation">abc</span><div class="endOfContent"></div>',
    );
    expect(renderedTextOf(layer).trim()).toBe("abc");
  });

  it("块级元素的前后各发一个换行", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>first</p><p>second</p>";
    expect(renderedTextOf(root)).toBe("\nfirst\n\nsecond\n");
  });

  it("嵌套的行内元素只贡献文本（查找高亮会包一层 span）", () => {
    const layer = textLayer(
      '<span role="presentation">spa<span class="highlight">rse</span> attention</span>',
    );
    expect(renderedTextOf(layer)).toBe("sparse attention");
  });

  it("表格的行与单元格边界会断开", () => {
    const root = document.createElement("div");
    root.innerHTML =
      "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>";
    expect(normalizePdfSelection(renderedTextOf(root))).toBe("a b c");
  });
});

/**
 * 整条链路的锚点测试。
 *
 * 单测 `normalizePdfSelection` 本身挡不住这类缺陷：它的「把硬换行折成空格」在上游
 * 用 `Range.toString()` 的那段时间里从未被触发过（真实输入根本不含 `\n`），而用例喂
 * 的是手写的、带 `\n` 的理想输入，于是全绿。要有意义就得从**真实的 DOM 形状**开始跑。
 */
describe("pdf 文本层 → 引用块（端到端形状）", () => {
  it("从真实文本层形状产出可读的一行引用", () => {
    const layer = textLayer(
      [
        '<span role="presentation">a lightweight lightning indexer selects the top-k most relevant</span>',
        '<br role="presentation">',
        '<span role="presentation">tokens per query, reducing core attention from O(</span>',
        '<span role="presentation">L2</span>',
        '<span role="presentation">) to O</span>',
      ].join(""),
    );

    const quote = buildQuoteBlock(normalizePdfSelection(renderedTextOf(layer)));

    expect(quote).toBe(
      "> a lightweight lightning indexer selects the top-k most relevant tokens per query, reducing core attention from O(L2) to O\n\n",
    );
    // 修复前这里会是 `relevanttokens`
    expect(quote).not.toContain("relevanttokens");
  });

  it("行尾连字符断词按既定取舍折成 `infer- ence`，不做 de-hyphenate", () => {
    const layer = textLayer(
      [
        '<span role="presentation">attention efficiency critical for both infer-</span>',
        '<br role="presentation">',
        '<span role="presentation">ence speed and serving cost.</span>',
      ].join(""),
    );

    expect(normalizePdfSelection(renderedTextOf(layer))).toBe(
      "attention efficiency critical for both infer- ence speed and serving cost.",
    );
  });

  it("atomicTextOf 返回空串时整棵子树被折算掉、不继续递归", () => {
    // 这是 `!= null` 而不是真值判断的唯一证据：空串的语义是「原子但无文本」。写成
    // `if (atomic)` 的话下面这段隐藏文本会被递归收进来——KaTeX 缺 annotation 时
    // 泄漏 MathML 副本正是这个形状（见 quote-text.ts 注入的那条规则）。
    const root = document.createElement("div");
    root.innerHTML =
      '<p>before <span class="atom">hidden copy</span> after</p>';

    expect(
      renderedTextOf(root, {
        atomicTextOf: (el) => (el.classList.contains("atom") ? "" : null),
      }).replace(/\s+/g, " "),
    ).toBe(" before after ");
  });
});
