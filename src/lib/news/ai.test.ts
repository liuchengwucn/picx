import { afterEach, describe, expect, it, vi } from "vitest";
import { extractFirstJsonObject } from "#/lib/json-extract";
import { embedTexts, NewsAiError, normalizeKeyFacts } from "./ai";

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
