import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { sanitizeAssistantParts } from "./chat-stream";

const textPart = { type: "text", text: "hello" };
const toolPart = {
  type: "tool-readPaper",
  toolCallId: "c1",
  state: "output-available",
  input: { section: 1 },
  output: { text: "x".repeat(1000) },
};
const cardToolPart = {
  type: "tool-searchArxiv",
  toolCallId: "c2",
  state: "output-available",
  input: { query: "llm" },
  output: { results: [{ title: "t" }] },
};
const webSearchPart = {
  type: "tool-web_search",
  toolCallId: "c3",
  state: "output-available",
  input: { results: ["big"] },
  output: { results: ["big"] },
};

describe("sanitizeAssistantParts", () => {
  it("keeps text parts untouched", () => {
    const out = sanitizeAssistantParts([textPart] as UIMessage["parts"]);
    expect(out).toEqual([textPart]);
  });

  it("strips output from tool parts by default", () => {
    const [out] = sanitizeAssistantParts([toolPart] as UIMessage["parts"]);
    expect(out).not.toHaveProperty("output");
    expect(out).toHaveProperty("input");
  });

  it("keeps output for whitelisted card tools", () => {
    const [out] = sanitizeAssistantParts(
      [cardToolPart] as UIMessage["parts"],
      new Set(["tool-searchArxiv"]),
    );
    expect(out).toHaveProperty("output");
  });

  it("strips output from card tools when no whitelist is passed", () => {
    const [out] = sanitizeAssistantParts([cardToolPart] as UIMessage["parts"]);
    expect(out).not.toHaveProperty("output");
    expect(out).toHaveProperty("input");
  });

  it("strips both input and output from web_search", () => {
    const [out] = sanitizeAssistantParts([webSearchPart] as UIMessage["parts"]);
    expect(out).not.toHaveProperty("output");
    expect(out).not.toHaveProperty("input");
  });

  it("normalizes streaming reasoning state to done", () => {
    const [out] = sanitizeAssistantParts([
      { type: "reasoning", text: "thinking", state: "streaming" },
    ] as UIMessage["parts"]);
    expect(out).toMatchObject({ state: "done", text: "thinking" });
  });

  it("leaves reasoning parts already in done state unchanged", () => {
    const donePart = { type: "reasoning", text: "thinking", state: "done" };
    const [out] = sanitizeAssistantParts([donePart] as UIMessage["parts"]);
    expect(out).toEqual(donePart);
  });
});
