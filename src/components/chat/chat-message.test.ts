import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { hasVisibleParts, normalizeMathDelimiters } from "./chat-message";

describe("normalizeMathDelimiters", () => {
  it("把 \\(...\\) 转成行内 $ 定界符", () => {
    expect(normalizeMathDelimiters("能量 \\(E = mc^2\\) 守恒")).toBe(
      "能量 $E = mc^2$ 守恒",
    );
  });

  it("把跨行的 \\[...\\] 转成 $$ 定界符", () => {
    expect(
      normalizeMathDelimiters("推导：\n\\[\n\\sum_{i=1}^n x_i\n\\]\n结束"),
    ).toBe("推导：\n$$\n\\sum_{i=1}^n x_i\n$$\n结束");
  });

  it("已是 $ 定界符的内容原样保留", () => {
    const text = "行内 $a+b$ 与块级\n\n$$\nc^2\n$$";
    expect(normalizeMathDelimiters(text)).toBe(text);
  });

  it("跳过代码围栏与行内代码", () => {
    const fenced = "```tex\n\\(x\\)\n```";
    expect(normalizeMathDelimiters(fenced)).toBe(fenced);
    const inline = "正则 `\\(foo\\)` 不是公式";
    expect(normalizeMathDelimiters(inline)).toBe(inline);
  });

  it("流式未闭合的代码围栏也按代码跳过", () => {
    const streaming = "```tex\n\\(x\\)";
    expect(normalizeMathDelimiters(streaming)).toBe(streaming);
  });

  it("未闭合的定界符不动，等流式补全", () => {
    expect(normalizeMathDelimiters("推导 \\(a + b")).toBe("推导 \\(a + b");
  });
});

describe("hasVisibleParts", () => {
  const assistantWith = (parts: unknown[]): UIMessage =>
    ({ id: "a1", role: "assistant", parts }) as UIMessage;

  it("刚收到 start chunk 的空消息不算可见", () => {
    expect(hasVisibleParts(assistantWith([]))).toBe(false);
  });

  it("空 text/reasoning part 不算可见（流刚起步的空增量）", () => {
    expect(
      hasVisibleParts(
        assistantWith([
          { type: "text", text: "" },
          { type: "reasoning", text: "", state: "streaming" },
          { type: "step-start" },
        ]),
      ),
    ).toBe(false);
  });

  it("首个非空 text 或 reasoning 增量即算可见", () => {
    expect(hasVisibleParts(assistantWith([{ type: "text", text: "你" }]))).toBe(
      true,
    );
    expect(
      hasVisibleParts(
        assistantWith([{ type: "reasoning", text: "想", state: "streaming" }]),
      ),
    ).toBe(true);
  });

  it("工具调用一出现就算可见（本地工具与 dynamic-tool）", () => {
    expect(
      hasVisibleParts(
        assistantWith([
          {
            type: "tool-readPaper",
            toolCallId: "c1",
            state: "input-streaming",
          },
        ]),
      ),
    ).toBe(true);
    expect(
      hasVisibleParts(
        assistantWith([
          { type: "dynamic-tool", toolCallId: "c2", state: "input-streaming" },
        ]),
      ),
    ).toBe(true);
  });

  it("来源 part 算可见", () => {
    expect(
      hasVisibleParts(
        assistantWith([
          { type: "source-url", sourceId: "s1", url: "https://example.com" },
        ]),
      ),
    ).toBe(true);
  });
});
