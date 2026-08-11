// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { pageNumberOfSelection } from "./pdf-selection-page";

function rangeIn(html: string, selector: string): Range {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  const target = host.querySelector(selector);
  if (!target) throw new Error("unreachable");
  const range = document.createRange();
  range.selectNodeContents(target);
  return range;
}

describe("pageNumberOfSelection", () => {
  it("取起点所在 .page 的 data-page-number", () => {
    const range = rangeIn(
      '<div class="page" data-page-number="7"><span class="t">hi</span></div>',
      ".t",
    );
    expect(pageNumberOfSelection(range, 1)).toBe(7);
  });

  it("起点不在任何 .page 里时退回 fallback", () => {
    const range = rangeIn('<div><span class="t">hi</span></div>', ".t");
    expect(pageNumberOfSelection(range, 4)).toBe(4);
  });

  it("data-page-number 不是正整数时退回 fallback", () => {
    const range = rangeIn(
      '<div class="page" data-page-number="0"><span class="t">hi</span></div>',
      ".t",
    );
    expect(pageNumberOfSelection(range, 3)).toBe(3);
  });
});
