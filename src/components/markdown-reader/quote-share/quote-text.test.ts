// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { KATEX_ALPHA, mount } from "./quote-test-fixtures";
import { quoteTextOfSelection } from "./quote-text";

/** 下游 normalizePdfSelection 会把所有空白折成单空格，这里照它的口径看最终形态 */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 选中某个元素的全部子节点（不含它自己，免得块级标签自己再发一对换行） */
function selectContentsOf(el: Element): Range {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range;
}

function firstTextNode(el: Element): Text {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text;
}

describe("quoteTextOfSelection", () => {
  it("表格单元格之间产生空白，不会焊成一个词", () => {
    const article = mount(
      "<table><thead><tr><th>Method</th><th>Acc</th></tr></thead>" +
        "<tbody><tr><td>Ours</td><td>91.2</td></tr></tbody></table>",
    );
    const text = quoteTextOfSelection(selectContentsOf(article));
    expect(collapse(text)).toBe("Method Acc Ours 91.2");
    // 回归守卫：走 normalizeBlock 的锚点路径这里得到的是 "MethodAccOurs91.2"
    expect(text).not.toContain("MethodAcc");
  });

  it("KaTeX 折成 LaTeX 源，MathML 副本不泄漏", () => {
    const article = mount(`<p>rate ${KATEX_ALPHA} grows</p>`);
    const p = article.firstElementChild as Element;
    // 用 toBe 而不是 toContain：MathML 那份文本（"α"）泄漏进来就会红
    expect(quoteTextOfSelection(selectContentsOf(p))).toBe(
      "rate $\\alpha$ grows",
    );
  });

  it("只选图注时只拿到图注，不会扩成整块", () => {
    const article = mount(
      "<div>before<figure><figcaption>Fig 1: caption</figcaption></figure>after</div>",
    );
    const caption = article.querySelector("figcaption") as Element;
    const text = quoteTextOfSelection(selectContentsOf(caption));
    expect(collapse(text)).toBe("Fig 1: caption");
    // 锚点路径在这里会退化成「块首/块尾」，产出用户根本没选的 "beforeafter"
    expect(text).not.toContain("before");
    expect(text).not.toContain("after");
  });

  it("跨两个段落的真实选区：块边界带空白，内容与视觉选中一致", () => {
    const article = mount("<p>alpha one</p><p>beta two</p>");
    const [first, second] = Array.from(article.children);
    const range = document.createRange();
    range.setStart(firstTextNode(first), "alpha ".length);
    range.setEnd(firstTextNode(second), "beta".length);
    const text = quoteTextOfSelection(range);
    expect(text).toMatch(/one\s+beta/);
    expect(collapse(text)).toBe("one beta");
  });
});
