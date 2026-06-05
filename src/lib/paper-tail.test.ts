import { describe, expect, it } from "vitest";
import {
  matchesPaperTailHeading,
  normalizeHeadingCandidate,
} from "./paper-tail";

/** 模拟真实用法:先归一化一行,再判断是否尾部标题。 */
function isTail(line: string): boolean {
  return matchesPaperTailHeading(normalizeHeadingCandidate(line));
}

describe("paper-tail heading detection", () => {
  it("matches end-matter headings across en/zh/ja", () => {
    const tails = [
      "References",
      "REFERENCES",
      "Bibliography",
      "Appendix",
      "Appendix A",
      "Supplementary Material",
      "Acknowledgments",
      "Acknowledgements",
      "参考文献",
      "附录",
      "致谢",
      "謝辞",
      "付録",
    ];
    for (const line of tails) {
      expect(isTail(line), line).toBe(true);
    }
  });

  it("strips leading numbering / chapter prefixes before matching", () => {
    expect(isTail("1. References")).toBe(true);
    expect(isTail("6  References")).toBe(true);
    expect(isTail("Section 5 References")).toBe(true);
    expect(isTail("第5章 参考文献")).toBe(true);
    expect(isTail("【参考文献】")).toBe(true);
  });

  it("does not match body headings", () => {
    const body = [
      "Introduction",
      "Methods",
      "Results and Discussion",
      "Related Work",
      "Conclusion",
      "We reference prior work here",
      "",
    ];
    for (const line of body) {
      expect(isTail(line), line).toBe(false);
    }
  });

  it("rejects overly long lines (not standalone headings)", () => {
    const long = `References ${"x".repeat(200)}`;
    expect(matchesPaperTailHeading(long)).toBe(false);
  });
});
