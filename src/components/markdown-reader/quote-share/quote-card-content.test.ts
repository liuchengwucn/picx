// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { QuoteAnchor } from "./quote-anchor";
import { fingerprint } from "./quote-anchor";
import {
  buildCardContent,
  type CardContent,
  MARK_CLASS,
  MUTED_CLASS,
} from "./quote-card-content";

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<article class="reader-prose">${html}</article>`;
  return document.querySelector("article") as HTMLElement;
}

/** 指纹不参与卡片构建，随便给一个即可 */
function anchorOf(
  startBlock: number,
  startOffset: number,
  endBlock: number,
  endOffset: number,
): QuoteAnchor {
  return {
    startBlock,
    startOffset,
    endBlock,
    endOffset,
    fingerprint: fingerprint("x"),
  };
}

function expectContent(content: CardContent | null): CardContent {
  expect(content).not.toBeNull();
  if (!content) {
    throw new Error("unreachable");
  }
  return content;
}

function textOf(content: CardContent, className: string): string {
  return content.blocks
    .flatMap((block) => Array.from(block.querySelectorAll(`.${className}`)))
    .map((el) => el.textContent ?? "")
    .join("");
}

/** n 个句子，每句 20 字符（"Sentence NN padding." 恰好 20），拼出可精确定位边界的长段 */
function sentences(n: number): string {
  return Array.from(
    { length: n },
    (_, i) => `Sentence ${String(i).padStart(2, "0")} paddin.`,
  ).join("");
}

describe("buildCardContent", () => {
  it("选区没超上限时整段高亮，不标记截断", () => {
    const body = sentences(20); // 400 字符
    const article = mount(`<p>${body}</p>`);

    const content = expectContent(
      buildCardContent(article, anchorOf(0, 0, 0, body.length)),
    );

    expect(content.truncated).toBe(false);
    expect(textOf(content, MARK_CLASS)).toBe(body);
  });

  it("选区超过 MAX_QUOTE 才截断——2000 以内的整段选区必须完整保留", () => {
    // 回归：上限曾是 400，一段论文正文选下来只剩前一两句
    const body = sentences(90); // 1800 字符
    const article = mount(`<p>${body}</p>`);

    const content = expectContent(
      buildCardContent(article, anchorOf(0, 0, 0, body.length)),
    );

    expect(content.truncated).toBe(false);
    expect(textOf(content, MARK_CLASS)).toBe(body);
  });

  it("截断时不把选区剩余部分当下文压灰", () => {
    // 回归：截断后仍无条件补 MAX_CONTEXT 的「后文」，而那段本就在选区内，
    // 压灰渲染等于告诉读者「这不是你选的」
    const body = sentences(150); // 3000 字符
    const article = mount(`<p>${body}</p>`);

    const content = expectContent(
      buildCardContent(article, anchorOf(0, 0, 0, body.length)),
    );

    expect(content.truncated).toBe(true);
    expect(textOf(content, MUTED_CLASS)).toBe("");
    expect(content.blocks[0].textContent?.endsWith("…")).toBe(true);
  });

  it("为了断在句边界最多回退 BOUNDARY_SLACK，不随上限等比放大", () => {
    // 回归：旧实现按 max * 0.5 收口，上限抬到 2000 后等于允许为一个句号白扔 1000 字
    const body = sentences(150);
    const article = mount(`<p>${body}</p>`);

    const content = expectContent(
      buildCardContent(article, anchorOf(0, 0, 0, body.length)),
    );

    const marked = textOf(content, MARK_CLASS);
    expect(marked.length).toBeLessThanOrEqual(2000);
    expect(marked.length).toBeGreaterThanOrEqual(2000 - 160);
    expect(marked.endsWith(".")).toBe(true);
  });

  it("选区之外的前后文压灰并补省略号", () => {
    const body = sentences(40); // 800 字符
    const article = mount(`<p>${body}</p>`);

    // 选段落中部：两端离段首/段尾都超过 MAX_CONTEXT，前后文才会真的被裁出省略号
    const content = expectContent(
      buildCardContent(article, anchorOf(0, 300, 0, 500)),
    );

    expect(content.truncated).toBe(false);
    expect(textOf(content, MARK_CLASS)).toBe(body.slice(300, 500));
    expect(textOf(content, MUTED_CLASS).length).toBeGreaterThan(0);
    const rendered = content.blocks[0].textContent ?? "";
    expect(rendered.startsWith("…")).toBe(true);
    expect(rendered.endsWith("…")).toBe(true);
  });
});
