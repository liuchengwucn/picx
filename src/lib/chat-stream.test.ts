import type { TextStreamPart, ToolSet, UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  buildStepPolicy,
  sanitizeAssistantParts,
  splitInterleavedSegments,
} from "./chat-stream";

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

type Chunk = TextStreamPart<ToolSet>;

function streamOf(chunks: Chunk[]): ReadableStream<Chunk> {
  return new ReadableStream<Chunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Chunk>): Promise<Chunk[]> {
  const reader = stream.getReader();
  const out: Chunk[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(value);
  }
}

/** 便于断言的紧凑表示："reasoning-delta@r#1" */
function brief(chunk: Chunk): string {
  const id = "id" in chunk ? chunk.id : "";
  return `${chunk.type}@${id}`;
}

describe("splitInterleavedSegments", () => {
  it("splits merged-id reasoning/text into interleaved segments", async () => {
    // OpenRouter 服务端搜索的实测形状：整回合 reasoning 共用 id r、text 共用 id t，
    // 增量按 思考→正文→思考→正文 交替到达
    const out = await collect(
      splitInterleavedSegments(
        streamOf([
          { type: "reasoning-start", id: "r" },
          { type: "reasoning-delta", id: "r", text: "想1" },
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", text: "文1" },
          { type: "reasoning-delta", id: "r", text: "想2" },
          { type: "text-delta", id: "t", text: "文2" },
          { type: "reasoning-end", id: "r" },
          { type: "text-end", id: "t" },
        ] as Chunk[]),
      ),
    );
    expect(out.map(brief)).toEqual([
      "reasoning-start@r",
      "reasoning-delta@r",
      "text-start@t",
      "text-delta@t",
      // 思考回流：结束旧段、开新段
      "reasoning-end@r",
      "reasoning-start@r#1",
      "reasoning-delta@r#1",
      // 正文回流：同理
      "text-end@t",
      "text-start@t#2",
      "text-delta@t#2",
      // 原始 end 映射到各自最新的段
      "reasoning-end@r#1",
      "text-end@t#2",
    ]);
  });

  it("is an identity transform for properly segmented streams", async () => {
    const chunks = [
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", text: "a" },
      { type: "reasoning-end", id: "r1" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", text: "b" },
      { type: "text-end", id: "t1" },
      { type: "reasoning-start", id: "r2" },
      { type: "reasoning-delta", id: "r2", text: "c" },
      { type: "reasoning-end", id: "r2" },
    ] as Chunk[];
    const out = await collect(splitInterleavedSegments(streamOf(chunks)));
    expect(out).toEqual(chunks);
  });

  it("cuts the flowing text segment when sources arrive", async () => {
    // 2026-08-06 实测形状：服务端搜索的来源批次夹在同一个 text part 的增量中间
    // 到达；截断正文段，来源组才能按真实位置落在两段正文之间
    const out = await collect(
      splitInterleavedSegments(
        streamOf([
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", text: "先搜A" },
          {
            type: "source",
            sourceType: "url",
            id: "s1",
            url: "https://example.com/1",
          },
          {
            type: "source",
            sourceType: "url",
            id: "s2",
            url: "https://example.com/2",
          },
          { type: "text-delta", id: "t", text: "小结A" },
          { type: "text-end", id: "t" },
        ] as Chunk[]),
      ),
    );
    expect(out.map(brief)).toEqual([
      "text-start@t",
      "text-delta@t",
      // 来源到达 → 截断当前正文段；相邻的第二条来源不再重复截断
      "text-end@t",
      "source@s1",
      "source@s2",
      // 正文回来 → 新段（截断时已发过 end，这里只开新段）
      "text-start@t#1",
      "text-delta@t#1",
      "text-end@t#1",
    ]);
  });

  it("passes through tool chunks without breaking segments", async () => {
    const out = await collect(
      splitInterleavedSegments(
        streamOf([
          { type: "reasoning-start", id: "r" },
          { type: "reasoning-delta", id: "r", text: "a" },
          { type: "tool-input-start", id: "call1", toolName: "readPaper" },
          { type: "reasoning-delta", id: "r", text: "b" },
          { type: "reasoning-end", id: "r" },
        ] as Chunk[]),
      ),
    );
    expect(out.map((c) => c.type)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "tool-input-start",
      "reasoning-delta",
      "reasoning-end",
    ]);
  });

  it("starts a fresh segment when the same id restarts after end", async () => {
    const out = await collect(
      splitInterleavedSegments(
        streamOf([
          { type: "reasoning-start", id: "r" },
          { type: "reasoning-delta", id: "r", text: "a" },
          { type: "reasoning-end", id: "r" },
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", text: "b" },
          { type: "text-end", id: "t" },
          // 同一原始 id 二次 start：不给新 id 的话会归并回旧 part
          { type: "reasoning-start", id: "r" },
          { type: "reasoning-delta", id: "r", text: "c" },
          { type: "reasoning-end", id: "r" },
        ] as Chunk[]),
      ),
    );
    const reasoningIds = new Set(
      out
        .filter((c) => c.type.startsWith("reasoning"))
        .map((c) => ("id" in c ? c.id : "")),
    );
    expect(reasoningIds.size).toBe(2);
  });
});

describe("buildStepPolicy", () => {
  const prep = buildStepPolicy(12, "SYSTEM PROMPT").prepareStep;

  it("leaves tool-capable steps untouched", () => {
    expect(prep({ stepNumber: 0 })).toStrictEqual({});
    expect(prep({ stepNumber: 11 })).toStrictEqual({});
  });

  it("strips every tool on the closing step", () => {
    const overrides = prep({ stepNumber: 12 });
    expect(overrides.activeTools).toEqual([]);
    expect(overrides.instructions).toContain("SYSTEM PROMPT");
    expect(overrides.instructions).toContain("no tools are available");
  });

  it("tells the closing step to follow the user's language and drop cards", () => {
    const { instructions } = prep({ stepNumber: 12 });
    // 这两条不是文案偏好：模型受扰动会飘语言，且卡片工具此刻已被收走
    expect(instructions).toContain("same language the user has been using");
    expect(instructions).toContain("arXiv link inline");
  });

  it("keeps stripping past the boundary — stopWhen is only a backstop", () => {
    expect(prep({ stepNumber: 99 }).activeTools).toEqual([]);
  });

  it("keeps stopWhen and prepareStep in agreement about the last step", () => {
    const policy = buildStepPolicy(12, "S");
    // isStepCount(N) 在 steps.length === N 时停 ⇒ 最后执行的一步 stepNumber 是 N-1
    expect(policy.stopWhen({ steps: Array(12).fill({}) } as never)).toBe(false);
    expect(policy.stopWhen({ steps: Array(13).fill({}) } as never)).toBe(true);
    expect(policy.prepareStep({ stepNumber: 11 })).toStrictEqual({});
    expect(policy.prepareStep({ stepNumber: 12 }).activeTools).toEqual([]);
  });

  it("still grants one tool step when the budget is 1", () => {
    const policy = buildStepPolicy(1, "S");
    expect(policy.prepareStep({ stepNumber: 0 })).toStrictEqual({});
    expect(policy.prepareStep({ stepNumber: 1 }).activeTools).toEqual([]);
  });
});
