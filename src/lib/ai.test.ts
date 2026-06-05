import { afterEach, describe, expect, it, vi } from "vitest";
import { type AIConfig, classifyPaper, parseClassification } from "./ai";

describe("parseClassification", () => {
  it("extracts valid categories and tags from clean JSON", () => {
    const out = parseClassification(
      '{"categories":["multimodal","vision"],"tags":["Image-Restoration","Diffusion"]}',
    );
    expect(out.categories).toEqual(["multimodal", "vision"]);
    expect(out.tags).toEqual(["image-restoration", "diffusion"]);
  });

  it("drops invalid category slugs, falls back to ['other'] if none valid", () => {
    const out = parseClassification('{"categories":["banana"],"tags":["x"]}');
    expect(out.categories).toEqual(["other"]);
  });

  it("caps categories at 3 and tags at 6", () => {
    const out = parseClassification(
      '{"categories":["llm","nlp","vision","agents"],"tags":["a","b","c","d","e","f","g"]}',
    );
    expect(out.categories).toHaveLength(3);
    expect(out.tags).toHaveLength(6);
  });

  it("tolerates surrounding prose / code fences", () => {
    const out = parseClassification(
      'Here you go:\n```json\n{"categories":["llm"],"tags":["rag"]}\n```',
    );
    expect(out.categories).toEqual(["llm"]);
    expect(out.tags).toEqual(["rag"]);
  });

  it("returns safe fallback on garbage", () => {
    const out = parseClassification("not json at all");
    expect(out).toEqual({ categories: ["other"], tags: [] });
  });
});

describe("classifyPaper", () => {
  const config: AIConfig = {
    openaiApiKey: "test-key",
    geminiApiKey: "test-key",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: () => Promise<unknown>) {
    vi.stubGlobal("fetch", vi.fn(impl as never));
  }

  it("returns parsed categories/tags on a valid response", async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          { message: { content: '{"categories":["llm"],"tags":["rag"]}' } },
        ],
      }),
    }));
    const out = await classifyPaper("some paper text", config);
    expect(out).toEqual({ categories: ["llm"], tags: ["rag"] });
  });

  it("throws on a non-ok response so the caller can retry", async () => {
    stubFetch(async () => ({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "overloaded",
    }));
    await expect(classifyPaper("x", config)).rejects.toThrow();
  });

  it("throws on an unparseable/garbled body (the silent-other bug)", async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Sorry, I cannot do that." } }],
      }),
    }));
    await expect(classifyPaper("x", config)).rejects.toThrow();
  });

  it("throws when categories come back empty with no tags (truncated JSON)", async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"categories":[],"tags":[]}' } }],
      }),
    }));
    await expect(classifyPaper("x", config)).rejects.toThrow();
  });
});
