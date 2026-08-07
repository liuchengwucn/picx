// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  anchorToRange,
  blocksOf,
  decodeAnchor,
  encodeAnchor,
  fingerprint,
  normalizeBlock,
  type QuoteAnchor,
  rangeToAnchor,
} from "./quote-anchor";

/** 断言锚点非空并收窄类型，避免在测试里撒 `!` */
function expectAnchor(anchor: QuoteAnchor | null): QuoteAnchor {
  expect(anchor).not.toBeNull();
  if (!anchor) {
    throw new Error("unreachable");
  }
  return anchor;
}

/**
 * 真实 KaTeX 产物的最小复刻：mathml 与 html 各含一份「α」，textContent 会拿到两份。
 */
const KATEX_ALPHA =
  '<span class="katex">' +
  '<span class="katex-mathml"><math><semantics><mrow><mi>α</mi></mrow>' +
  '<annotation encoding="application/x-tex">\\alpha</annotation>' +
  "</semantics></math></span>" +
  '<span class="katex-html" aria-hidden="true">α</span>' +
  "</span>";

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<article class="reader-prose">${html}</article>`;
  return document.querySelector("article") as HTMLElement;
}

/** 在第 blockIndex 个块的规范化偏移区间上造一个真实 Range */
function rangeAt(
  article: HTMLElement,
  blockIndex: number,
  from: number,
  to: number,
): Range {
  const block = blocksOf(article)[blockIndex];
  const nb = normalizeBlock(block);
  const seg = nb.segments[0];
  const range = document.createRange();
  range.setStart(seg.node, from - seg.start);
  range.setEnd(seg.node, to - seg.start);
  return range;
}

describe("normalizeBlock", () => {
  it("跳过 KaTeX 的 MathML 副本，公式折算成 LaTeX 源", () => {
    const article = mount(`<p>rate ${KATEX_ALPHA} grows</p>`);
    const { text } = normalizeBlock(blocksOf(article)[0]);
    // textContent 会含三份文本：mi 的 "α" + annotation 的 "\alpha" + katex-html 的
    // "α"，jsdom 的 textContent 不管 CSS 可见性，annotation 也照样计入
    expect(blocksOf(article)[0].textContent).toBe("rate α\\alphaα grows");
    expect(text).toBe("rate $\\alpha$ grows");
  });

  it("丢弃插图与图注", () => {
    // 用 div 而非 p 装块：figure 是流内容，浏览器/jsdom 的 HTML 解析器会在遇到
    // <figure> 前隐式闭合 <p>（p 只允许 phrasing content），嵌进 p 里会把 "after"
    // 挤到块外面去，跟 SKIPPED_TAGS 逻辑本身无关，纯粹是 HTML 解析规则
    const article = mount(
      "<div>before<figure><img src='x.png'><figcaption>Fig 1</figcaption></figure>after</div>",
    );
    expect(normalizeBlock(blocksOf(article)[0]).text).toBe("beforeafter");
  });

  it("解析 DOM 点在规范化文本里的偏移", () => {
    const article = mount("<p>hello <em>world</em></p>");
    const block = blocksOf(article)[0];
    const em = block.querySelector("em") as HTMLElement;
    const { resolved } = normalizeBlock(block, [
      { node: em.firstChild as Text, offset: 3 },
    ]);
    expect(resolved[0]).toBe(9);
  });
});

describe("rangeToAnchor / anchorToRange", () => {
  it("纯文本选区往返一致", () => {
    const article = mount("<p>alpha beta gamma delta</p>");
    const anchor = rangeToAnchor(article, rangeAt(article, 0, 6, 16));
    expect(anchor).not.toBeNull();
    expect(anchor?.startOffset).toBe(6);
    expect(anchor?.endOffset).toBe(16);

    const range = anchorToRange(article, expectAnchor(anchor));
    expect(range?.toString()).toBe("beta gamma");
  });

  it("含公式的块偏移往返一致", () => {
    const article = mount(`<p>let ${KATEX_ALPHA} be small enough</p>`);
    const block = blocksOf(article)[0];
    const { text } = normalizeBlock(block);
    // 规范化后是 "let $\alpha$ be small enough"，选其中的 "be small"
    const expected = text.indexOf("be small");

    const tail = block.lastChild as Text;
    const local = tail.data.indexOf("be small");
    const range = document.createRange();
    range.setStart(tail, local);
    range.setEnd(tail, local + "be small".length);

    const anchor = rangeToAnchor(article, range);
    expect(anchor?.startOffset).toBe(expected);
    expect(anchorToRange(article, expectAnchor(anchor))?.toString()).toBe(
      "be small",
    );
  });

  it("空选区被拒", () => {
    const article = mount("<p>alpha beta</p>");
    const collapsed = document.createRange();
    collapsed.setStart(blocksOf(article)[0].firstChild as Text, 3);
    collapsed.collapse(true);
    expect(rangeToAnchor(article, collapsed)).toBeNull();
  });

  it("跨块选区往返一致", () => {
    const article = mount("<p>first block here</p><p>second block here</p>");
    const first = blocksOf(article)[0].firstChild as Text;
    const second = blocksOf(article)[1].firstChild as Text;
    const range = document.createRange();
    range.setStart(first, 6);
    range.setEnd(second, 6);

    const anchor = rangeToAnchor(article, range);
    expect(anchor?.startBlock).toBe(0);
    expect(anchor?.endBlock).toBe(1);
    expect(anchorToRange(article, expectAnchor(anchor))?.toString()).toBe(
      "block heresecond",
    );
  });

  it("块序整体平移后靠指纹找回", () => {
    const article = mount("<p>alpha one</p><p>target sentence here</p>");
    const anchor = rangeToAnchor(article, rangeAt(article, 1, 0, 6));
    expect(anchor?.startBlock).toBe(1);

    // 模拟渲染管线改动：正文前面多了一个块，原来的 1 变成 2
    article.insertAdjacentHTML("afterbegin", "<p>newly inserted</p>");
    const range = anchorToRange(article, expectAnchor(anchor));
    expect(range?.toString()).toBe("target");
  });

  it("内容对不上时返回 null 而不是指向错误位置", () => {
    const article = mount("<p>alpha one</p>");
    const anchor = rangeToAnchor(article, rangeAt(article, 0, 0, 5));
    const tampered = { ...expectAnchor(anchor), fingerprint: "zzzzz" };
    expect(anchorToRange(article, tampered)).toBeNull();
  });
});

describe("fingerprint", () => {
  it("指纹是固定值：算法被误改时往返测试抓不到，这里能", () => {
    // encodeAnchor/decodeAnchor 与 rangeToAnchor/anchorToRange 的往返测试用的都是
    // 同一份 fingerprint 实现，算法本身算错了（FNV 常量抄错、异或和乘法顺序颠倒）
    // 两头会一起错，往返测试照样绿。这里钉一个硬编码期望值防住这类回归。
    expect(fingerprint("the reward model saturates")).toBe("1ac4d34");
  });
});

describe("encodeAnchor / decodeAnchor", () => {
  it("编码串可原样解析回来", () => {
    const anchor = {
      startBlock: 42,
      startOffset: 13,
      endBlock: 44,
      endOffset: 197,
      fingerprint: "a4f2",
    };
    const encoded = encodeAnchor(anchor);
    expect(encoded).toBe("q=42.13-44.197.a4f2");
    expect(decodeAnchor(`#${encoded}`)).toEqual(anchor);
  });

  it("非法串一律返回 null", () => {
    expect(decodeAnchor("")).toBeNull();
    expect(decodeAnchor("#introduction")).toBeNull();
    expect(decodeAnchor("q=1.2-3")).toBeNull();
    expect(decodeAnchor("q=5.0-3.10.abc")).toBeNull(); // 块倒挂
    expect(decodeAnchor("q=5.10-5.10.abc")).toBeNull(); // 空区间
  });
});
