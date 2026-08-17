import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AIConfig,
  classifyPaper,
  generateSummary,
  parseClassification,
  translateSummary,
} from "./ai";

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

describe("generateSummary", () => {
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

  it("returns the summary on a normal first-attempt success", async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        choices: [
          { message: { content: "# Summary\n..." }, finish_reason: "stop" },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const out = await generateSummary("paper text", config, "en");
    expect(out).toBe("# Summary\n...");
    // 命中首轮成功时只应发一次请求, max_tokens 保持默认 8000（happy path 不变）
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.max_tokens).toBe(8000);
  });

  it("escalates max_tokens and retries once when the first attempt is truncated", async () => {
    let call = 0;
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => {
      call++;
      if (call === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              { message: { content: "cut off" }, finish_reason: "length" },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: "full summary" }, finish_reason: "stop" },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchSpy);
    const out = await generateSummary("paper text", config, "en");
    expect(out).toBe("full summary");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
    expect(secondBody.max_tokens).toBe(12000);
    expect(secondBody.messages[0].content).toContain("IMPORTANT");
  });

  it("throws if the escalated retry is also truncated", async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "cut off" }, finish_reason: "length" }],
      }),
    }));
    await expect(generateSummary("paper text", config, "en")).rejects.toThrow(
      /truncated/,
    );
  });
});

describe("translateSummary", () => {
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

  it("returns the translation on a normal success", async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          { message: { content: "繁體中文翻譯" }, finish_reason: "stop" },
        ],
      }),
    }));
    const out = await translateSummary("summary", "zh-tw", config);
    expect(out).toBe("繁體中文翻譯");
  });

  it("falls back to a script conversion call when zh-tw output looks Simplified", async () => {
    let call = 0;
    const fetchSpy = vi.fn(async () => {
      call++;
      if (call === 1) {
        // 首次翻译误用简体输出（含 SIMP_ONLY 字符集里的字）
        return {
          ok: true,
          json: async () => ({
            choices: [
              { message: { content: "这是简体输出" }, finish_reason: "stop" },
            ],
          }),
        };
      }
      // 简繁转换请求：返回繁体版本
      return {
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: "這是繁體輸出" }, finish_reason: "stop" },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchSpy);
    const out = await translateSummary("summary", "zh-tw", config);
    expect(out).toBe("這是繁體輸出");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws the original language error when the conversion fallback also fails", async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          { message: { content: "这是简体输出" }, finish_reason: "stop" },
        ],
      }),
    }));
    await expect(translateSummary("summary", "zh-tw", config)).rejects.toThrow(
      /Simplified, not Traditional/,
    );
  });
});
