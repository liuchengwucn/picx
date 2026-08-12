import { env } from "cloudflare:workers";
import type { TextStreamPart, ToolSet, UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  buildReplayHistory,
  buildStepPolicy,
  type ChatStreamBody,
  type ChatStreamSpec,
  chatStreamBody,
  createChatStreamHandler,
  sanitizeAssistantParts,
  splitInterleavedSegments,
  TRUNCATED_REPLY_MARKER,
} from "./chat-stream";

// handler 测试只需要一个登录态，绕开 better-auth 的真实会话查询
vi.mock("#/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "user-1" } }) } },
}));

// 生成阶段托管给 ChatRunner DO：mock 的 fetch 带可识别 header，
// 成功路径断言 handler 原样透传 DO 的响应而不是重新包一层
const runnerFetch = vi.fn(
  async (..._args: unknown[]) =>
    new Response("data: {}\n\n", {
      headers: {
        "content-type": "text/event-stream",
        "x-mock-do": "chat-runner",
      },
    }),
);
const idFromName = vi.fn((name: string) => name);
Object.assign(env, {
  CHAT_RUNNER: {
    idFromName,
    get: () => ({ fetch: runnerFetch }),
  },
});

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

describe("buildReplayHistory", () => {
  const textPart = (text: string) => ({ type: "text", text });
  const toolPart = (type: string) => ({
    type,
    toolCallId: "c1",
    state: "output-available",
    input: {},
    output: { results: [] },
  });

  it("keeps only text parts when no digest is provided", () => {
    const history = buildReplayHistory(
      [
        {
          id: "m1",
          role: "assistant",
          parts: [textPart("hello"), toolPart("tool-searchArxiv")],
        },
      ],
      undefined,
    );
    expect(history).toEqual([
      { id: "m1", role: "assistant", parts: [textPart("hello")] },
    ]);
  });

  it("replaces a textless assistant message with a truncation marker", () => {
    // 丢掉的话模型看不见自己上一轮搜过什么，会把整轮重做一遍
    const history = buildReplayHistory(
      [
        { id: "m1", role: "assistant", parts: [toolPart("tool-searchArxiv")] },
        { id: "m2", role: "user", parts: [textPart("still here")] },
      ],
      undefined,
    );
    expect(history.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(history[0].parts).toEqual([
      { type: "text", text: TRUNCATED_REPLY_MARKER },
    ]);
  });

  it("drops textless messages from other roles", () => {
    const history = buildReplayHistory(
      [
        { id: "m1", role: "user", parts: [] },
        { id: "m2", role: "user", parts: [textPart("still here")] },
      ],
      undefined,
    );
    expect(history.map((m) => m.id)).toEqual(["m2"]);
  });

  it("folds tool parts through the digest, preserving position", () => {
    const history = buildReplayHistory(
      [
        {
          id: "m1",
          role: "assistant",
          parts: [
            textPart("before"),
            toolPart("tool-recommendPapers"),
            textPart("after"),
          ],
        },
      ],
      (part) => (part.type === "tool-recommendPapers" ? "CARDS" : undefined),
    );
    expect(history[0].parts).toEqual([
      textPart("before"),
      textPart("CARDS"),
      textPart("after"),
    ]);
  });

  it("keeps a message alive when only the digest produced content", () => {
    const history = buildReplayHistory(
      [
        {
          id: "m1",
          role: "assistant",
          parts: [toolPart("tool-recommendPapers")],
        },
      ],
      () => "CARDS",
    );
    expect(history).toEqual([
      { id: "m1", role: "assistant", parts: [textPart("CARDS")] },
    ]);
  });

  it("does not fold tool parts whose digest returns undefined", () => {
    const history = buildReplayHistory(
      [
        {
          id: "m1",
          role: "assistant",
          parts: [textPart("kept"), toolPart("tool-searchArxiv")],
        },
      ],
      () => undefined,
    );
    expect(history[0].parts).toEqual([textPart("kept")]);
  });

  it("tolerates junk entries inside parts instead of 500ing the conversation", () => {
    // 历史行是任意年代写下的 JSON。这些形状会让 isStaticToolUIPart 对 type 取
    // startsWith 时抛，而抛出来的后果是这个会话此后每次请求都 500，用户无法自救
    const history = buildReplayHistory(
      [
        {
          id: "m1",
          role: "user",
          parts: [
            null,
            42,
            "hello",
            { foo: 1 },
            { type: 7 },
            textPart("survivor"),
          ] as unknown as UIMessage["parts"],
        },
      ],
      undefined,
    );
    expect(history).toEqual([
      { id: "m1", role: "user", parts: [textPart("survivor")] },
    ]);
  });

  it("spends the digest budget newest-first and drops the oldest lines", () => {
    // 每行 1.4k 字符 ≈ 8 篇满字数的实测上限；10 行必然超预算
    const line = "D".repeat(1400);
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      role: "assistant" as const,
      parts: [textPart(`t${i}`), toolPart("tool-recommendPapers")],
    }));
    const history = buildReplayHistory(rows, () => line);

    // 顺序不能因为倒着花预算而乱掉
    expect(history.map((m) => m.id)).toEqual(rows.map((r) => r.id));
    const digested = history
      .filter((m) => m.parts.some((p) => (p as { text: string }).text === line))
      .map((m) => m.id);
    // 用户此刻看得见的是最新那几条，留下来的必须是它们
    expect(digested).toEqual(["m5", "m6", "m7", "m8", "m9"]);
    const totalDigestChars = digested.length * line.length;
    expect(totalDigestChars).toBeLessThanOrEqual(8000);
    // 预算耗尽的行只丢 digest，正文 text part 照常留着
    expect(history[0].parts).toEqual([textPart("t0")]);
  });

  it("tolerates rows whose parts are not an array", () => {
    expect(
      buildReplayHistory(
        [
          { id: "m1", role: "user", parts: null },
          { id: "m2", role: "user", parts: [textPart("ok")] },
        ],
        undefined,
      ),
    ).toEqual([{ id: "m2", role: "user", parts: [textPart("ok")] }]);
  });
});

describe("createChatStreamHandler", () => {
  // 错误优先级：前置读并发化后所有校验结果一起 settle，返回顺序不再由 await 的
  // 先后天然保证；这里钉住串行时代的对外口径：鉴权失败 → session_full → rate_limited
  const makeRequest = () =>
    new Request("http://localhost/api/test", {
      method: "POST",
      body: JSON.stringify({
        message: {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        },
      }),
    });

  type TestSpec = ChatStreamSpec<ChatStreamBody, Record<string, never>>;

  const makeSpec = (overrides: Partial<TestSpec>): TestSpec => ({
    logTag: "chat",
    bodySchema: chatStreamBody,
    limits: { maxInputChars: 1000, maxMessages: 10 },
    authorize: async () => ({ ok: true, ctx: {} }),
    countMessages: async () => 0,
    checkRateLimit: async () => ({ ok: true }),
    loadHistoryRows: async () => [],
    buildInstructions: async () => "SYS",
    persistUserMessage: async () => {},
    conversationKey: () => "s1",
    buildJob: (_args, _ctx, prepared) => ({
      kind: "chat",
      sessionId: "s1",
      paperId: "p1",
      userId: "user-1",
      locale: "en",
      webSearch: true,
      reasoningEffort: "low",
      instructions: prepared.instructions,
      modelMessages: prepared.modelMessages,
    }),
    ...overrides,
  });

  it("authorize failure wins over session_full and rate_limited", async () => {
    const persistUserMessage = vi.fn(async () => {});
    const buildInstructions = vi.fn(async () => "SYS");
    const buildJob = vi.fn(makeSpec({}).buildJob);
    const handler = createChatStreamHandler(
      makeSpec({
        authorize: async () => ({
          ok: false,
          code: "session_not_found",
          status: 404,
        }),
        countMessages: async () => 999,
        checkRateLimit: async () => ({
          ok: false,
          code: "rate_limited_minute",
        }),
        persistUserMessage,
        buildInstructions,
        buildJob,
      }),
    );
    const response = await handler({ request: makeRequest() });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "session_not_found" });
    // 鉴权没过：不写库、不做挂在 authorize 后面的提示词查询，也不发生成任务
    expect(persistUserMessage).not.toHaveBeenCalled();
    expect(buildInstructions).not.toHaveBeenCalled();
    expect(buildJob).not.toHaveBeenCalled();
  });

  it("session_full wins over rate_limited", async () => {
    const persistUserMessage = vi.fn(async () => {});
    const buildJob = vi.fn(makeSpec({}).buildJob);
    const handler = createChatStreamHandler(
      makeSpec({
        countMessages: async () => 999,
        checkRateLimit: async () => ({
          ok: false,
          code: "rate_limited_minute",
        }),
        persistUserMessage,
        buildJob,
      }),
    );
    const response = await handler({ request: makeRequest() });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "session_full" });
    expect(persistUserMessage).not.toHaveBeenCalled();
    expect(buildJob).not.toHaveBeenCalled();
  });

  it("returns rate_limited when it is the only failure", async () => {
    const buildJob = vi.fn(makeSpec({}).buildJob);
    const handler = createChatStreamHandler(
      makeSpec({
        checkRateLimit: async () => ({ ok: false, code: "rate_limited_day" }),
        buildJob,
      }),
    );
    const response = await handler({ request: makeRequest() });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited_day" });
    expect(buildJob).not.toHaveBeenCalled();
  });

  it("persists the user message, then forwards the job to the DO and relays its response", async () => {
    runnerFetch.mockClear();
    idFromName.mockClear();
    const persistUserMessage = vi.fn(async () => {});
    const buildJob = vi.fn(makeSpec({}).buildJob);
    const handler = createChatStreamHandler(
      makeSpec({ persistUserMessage, buildJob }),
    );
    const response = await handler({ request: makeRequest() });

    // 响应必须是 DO stub 的响应本体（原样透传），不是 Worker 重新包的一层
    expect(response.headers.get("x-mock-do")).toBe("chat-runner");
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    // 生成任务在用户消息落库之后才发出（用户消息先于助手消息落库的不变量）
    expect(persistUserMessage).toHaveBeenCalledTimes(1);
    expect(buildJob).toHaveBeenCalledTimes(1);
    expect(buildJob.mock.invocationCallOrder[0]).toBeGreaterThan(
      persistUserMessage.mock.invocationCallOrder[0],
    );

    // DO 实例按 `${logTag}:${conversationKey}` 定位，同一会话固定同一实例
    expect(idFromName).toHaveBeenCalledWith("chat:s1");
    const [url, init] = runnerFetch.mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(url).toBe("https://chat-runner/run");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      kind: "chat",
      sessionId: "s1",
      instructions: "SYS",
    });
  });
});
