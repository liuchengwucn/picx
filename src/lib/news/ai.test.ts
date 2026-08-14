import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIConfig } from "#/lib/ai";
import { extractFirstJsonObject } from "#/lib/json-extract";
import {
  embedTexts,
  generateStoryContent,
  judgeAssignment,
  NewsAiError,
  normalizeKeyFacts,
  scoreRelevance,
} from "./ai";

const TEST_CONFIG: AIConfig = {
  openaiApiKey: "test-key",
  openaiBaseUrl: "https://llm.test/v1",
  openaiModel: "test-model",
  geminiApiKey: "unused",
};

/** mock chat completions：返回给定 JSON，捕获发出的 user prompt */
function stubChat(payload: unknown) {
  const calls: { user: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ user: body.messages[1].content });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(payload) },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200 },
      );
    }),
  );
  return calls;
}

describe("extractFirstJsonObject", () => {
  it("parses clean JSON as-is", () => {
    const text = '{"a": 1, "b": "two"}';
    expect(extractFirstJsonObject(text)).toBe(text);
  });

  it("extracts JSON from a fenced ```json block", () => {
    const text = '```json\n{"a": 1}\n```';
    expect(extractFirstJsonObject(text)).toBe('{"a": 1}');
  });

  it("does not truncate on `}` inside a string value", () => {
    const text = '{"a": "text with } brace inside", "b": 2}';
    const result = extractFirstJsonObject(text);
    expect(result).toBe(text);
    expect(JSON.parse(result as string)).toEqual({
      a: "text with } brace inside",
      b: 2,
    });
  });

  it("extracts JSON preceded by prose", () => {
    const text = 'Sure, here is the result: {"a": 1}';
    expect(extractFirstJsonObject(text)).toBe('{"a": 1}');
  });

  it("returns null for unbalanced/truncated JSON", () => {
    const text = '{"a": 1, "b": [1, 2';
    expect(extractFirstJsonObject(text)).toBeNull();
  });

  it("returns null when there is no `{` at all", () => {
    expect(extractFirstJsonObject("no json here")).toBeNull();
  });
});

describe("embedTexts", () => {
  const vec = () => Array.from({ length: 1024 }, () => 0.1);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls Workers AI REST API with auth and parses result", async () => {
    let requested = "";
    let init: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, i?: RequestInit) => {
        requested = String(url);
        init = i;
        return new Response(JSON.stringify({ result: { data: [vec()] } }), {
          status: 200,
        });
      }),
    );
    const out = await embedTexts(
      { kind: "rest", accountId: "acct1", apiToken: "tok1" },
      ["hello"],
    );
    expect(requested).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct1/ai/run/@cf/baai/bge-m3",
    );
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok1",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toBeInstanceOf(Float32Array);
    expect(out[0].length).toBe(1024);
  });

  it("throws NewsAiError with status on REST failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 403 })),
    );
    await expect(
      embedTexts({ kind: "rest", accountId: "a", apiToken: "t" }, ["x"]),
    ).rejects.toThrowError(NewsAiError);
  });

  it("uses the binding when provider kind is binding", async () => {
    const run = vi.fn(async () => ({ data: [vec(), vec()] }));
    const out = await embedTexts(
      { kind: "binding", ai: { run } as unknown as Ai },
      ["a", "b"],
    );
    expect(run).toHaveBeenCalledWith("@cf/baai/bge-m3", {
      text: ["a", "b"],
      truncate_inputs: true,
    });
    expect(out).toHaveLength(2);
  });

  it("rejects mismatched embedding count", async () => {
    const run = vi.fn(async () => ({ data: [vec()] }));
    await expect(
      embedTexts({ kind: "binding", ai: { run } as unknown as Ai }, ["a", "b"]),
    ).rejects.toThrow(/unexpected bge-m3 response shape/);
  });
});

describe("scoreRelevance", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses {items: [{score, gist}]} and clamps scores", async () => {
    stubChat({
      items: [
        { score: 85, gist: "  OpenAI releases a new model.  " },
        { score: 120, gist: 42 },
        { score: "nope", gist: "" },
      ],
    });
    const out = await scoreRelevance(
      [{ title: "a" }, { title: "b" }, { title: "c" }],
      TEST_CONFIG,
    );
    expect(out).toEqual([
      { score: 85, gist: "OpenAI releases a new model." },
      { score: 100, gist: null },
      { score: 0, gist: null },
    ]);
  });

  it("sends up to 800 excerpt chars per item", async () => {
    const calls = stubChat({ items: [{ score: 70, gist: "g" }] });
    const excerpt = `${"x".repeat(790)}MARKER${"y".repeat(200)}`;
    await scoreRelevance([{ title: "t", excerpt }], TEST_CONFIG);
    expect(calls[0].user).toContain("MARKER");
    expect(calls[0].user).not.toContain("y".repeat(10));
  });

  it("throws NewsAiError on items length mismatch", async () => {
    stubChat({ items: [{ score: 50, gist: "g" }] });
    await expect(
      scoreRelevance([{ title: "a" }, { title: "b" }], TEST_CONFIG),
    ).rejects.toThrowError(NewsAiError);
  });
});

describe("judgeAssignment", () => {
  afterEach(() => vi.unstubAllGlobals());

  const candidates = [{ title: "Story", summary: "Summary" }];

  it("uses gist as the item body when present", async () => {
    const calls = stubChat({ assign: 1 });
    const out = await judgeAssignment(
      {
        title: "对谈某人",
        excerpt: "背景铺垫".repeat(100),
        gist: "LatePost interviews X about RSI",
      },
      candidates,
      TEST_CONFIG,
    );
    expect(out).toBe(0);
    expect(calls[0].user).toContain("LatePost interviews X about RSI");
    expect(calls[0].user).not.toContain("背景铺垫");
  });

  it("falls back to excerpt when gist is null", async () => {
    const calls = stubChat({ assign: null });
    await judgeAssignment(
      { title: "t", excerpt: "some excerpt body", gist: null },
      candidates,
      TEST_CONFIG,
    );
    expect(calls[0].user).toContain("some excerpt body");
  });
});

describe("generateStoryContent", () => {
  afterEach(() => vi.unstubAllGlobals());

  const locales = (v: string) => ({
    en: v,
    "zh-cn": v,
    "zh-tw": v,
    ja: v,
  });
  const payload = {
    title: locales("t"),
    summary: locales("s"),
    keyFacts: { en: [], "zh-cn": [], "zh-tw": [], ja: [] },
    tags: ["ai"],
  };

  it("adds a TOPIC line for items with a gist, omits it otherwise", async () => {
    const calls = stubChat(payload);
    await generateStoryContent(
      [
        {
          title: "对谈某人",
          excerpt: "正文",
          gist: "LatePost interviews X",
          sourceName: "晚点",
          publishedAt: new Date("2026-08-10"),
        },
        {
          title: "另一条",
          excerpt: "正文2",
          sourceName: "别处",
          publishedAt: new Date("2026-08-10"),
        },
      ],
      TEST_CONFIG,
    );
    const blocks = calls[0].user.split("\n---\n");
    expect(blocks[0]).toContain("TOPIC: LatePost interviews X");
    expect(blocks[1]).not.toContain("TOPIC:");
  });
});

describe("normalizeKeyFacts", () => {
  it("returns all-empty record for missing/invalid input (never null)", () => {
    const empty = { en: [], "zh-cn": [], "zh-tw": [], ja: [] };
    expect(normalizeKeyFacts(undefined)).toEqual(empty);
    expect(normalizeKeyFacts(null)).toEqual(empty);
    expect(normalizeKeyFacts("nope")).toEqual(empty);
    expect(normalizeKeyFacts({ en: [], "zh-cn": [] })).toEqual(empty);
  });

  it("keeps 4 locale keys, trims, drops non-strings, caps at 5", () => {
    const out = normalizeKeyFacts({
      en: [" a ", "b", "c", "d", "e", "f", 42, ""],
      "zh-cn": ["一"],
    });
    expect(out.en).toEqual(["a", "b", "c", "d", "e"]);
    expect(out["zh-cn"]).toEqual(["一"]);
    expect(out["zh-tw"]).toEqual([]);
    expect(out.ja).toEqual([]);
  });
});
