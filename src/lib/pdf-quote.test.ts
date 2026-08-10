import { describe, expect, it } from "vitest";
import {
  appendPdfQuote,
  buildQuoteBlock,
  normalizePdfSelection,
} from "./pdf-quote";

describe("normalizePdfSelection", () => {
  it("把排版硬换行折成空格", () => {
    expect(normalizePdfSelection("we propose a\nnovel method\nfor this")).toBe(
      "we propose a novel method for this",
    );
  });

  it("压缩连续空白并去掉首尾空白", () => {
    expect(normalizePdfSelection("  a   \t b \n\n c  ")).toBe("a b c");
  });

  it("超长时截断并加省略号", () => {
    expect(normalizePdfSelection("abcdefghij", 4)).toBe("abcd…");
  });

  it("截断处正好是空格时不留下悬空空格", () => {
    expect(normalizePdfSelection("ab cd ef", 3)).toBe("ab…");
  });

  it("不改写行尾连字符断词", () => {
    expect(normalizePdfSelection("repre-\nsentation")).toBe("repre- sentation");
  });

  it("恰好等于上限时不截断", () => {
    expect(normalizePdfSelection("abcd", 4)).toBe("abcd");
  });
});

describe("buildQuoteBlock", () => {
  it("包成 markdown 引用块并留出书写空行", () => {
    expect(buildQuoteBlock("hello")).toBe("> hello\n\n");
  });
});

describe("appendPdfQuote", () => {
  it("输入框为空时直接就是引用块", () => {
    expect(appendPdfQuote("", "> a\n\n")).toBe("> a\n\n");
  });

  it("只有空白也当空处理", () => {
    expect(appendPdfQuote("  \n ", "> a\n\n")).toBe("> a\n\n");
  });

  it("追加在已有内容之后而不是覆盖", () => {
    expect(appendPdfQuote("why?", "> a\n\n")).toBe("why?\n\n> a\n\n");
  });

  it("已有内容尾部的空白折成固定的一个空行", () => {
    expect(appendPdfQuote("why?\n\n\n", "> a\n\n")).toBe("why?\n\n> a\n\n");
  });

  it("总长超上限时只截新引用，用户原文一个字不动", () => {
    const result = appendPdfQuote("hi", "> abcdefghij\n\n", 14);
    expect(result).toBe("hi\n\n> abcde…\n\n");
    expect(result.length).toBe(14);
    expect(result.startsWith("hi\n\n")).toBe(true);
  });

  it("恰好等于上限时不截断", () => {
    expect(appendPdfQuote("hi", "> ab\n\n", 10)).toBe("hi\n\n> ab\n\n");
  });

  it("剩余空间放不下一个像样的引用块时原样返回", () => {
    expect(appendPdfQuote("hello", "> abcdefghij\n\n", 9)).toBe("hello");
  });
});
