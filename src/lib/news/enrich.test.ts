import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanReadableContent,
  EnrichRateLimitError,
  fetchReadable,
} from "./enrich";

describe("cleanReadableContent", () => {
  it("drops image syntax and keeps link text", () => {
    const input =
      "[![logo](https://a.com/logo.png)](https://a.com/)\n\nRead [the announcement](https://a.com/post) today.";
    expect(cleanReadableContent(input)).toBe("Read the announcement today.");
  });

  it("collapses whitespace and truncates to 1000 chars", () => {
    const input = `${"word ".repeat(400)}\n\n\t end`;
    const out = cleanReadableContent(input);
    expect(out.length).toBe(1000);
    expect(out).not.toMatch(/\s{2}/);
  });
});

describe("fetchReadable", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(response: Partial<Response> & { json?: () => unknown }) {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      ...response,
    });
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  it("returns cleaned content from the JSON response", async () => {
    const content = `Some long enough article body about a model release. ${"x".repeat(40)}`;
    const mock = stubFetch({
      json: async () => ({ data: { content } }),
    });
    await expect(fetchReadable("https://example.com/post")).resolves.toBe(
      content,
    );
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("https://r.jina.ai/https://example.com/post");
    expect(init.headers.Accept).toBe("application/json");
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("sends Authorization when an api key is provided", async () => {
    const mock = stubFetch({
      json: async () => ({ data: { content: "y".repeat(100) } }),
    });
    await fetchReadable("https://example.com", "jina_key");
    expect(mock.mock.calls[0][1].headers.Authorization).toBe("Bearer jina_key");
  });

  it("returns null for too-short content and non-ok responses", async () => {
    stubFetch({ json: async () => ({ data: { content: "cookie wall" } }) });
    await expect(fetchReadable("https://example.com")).resolves.toBeNull();
    stubFetch({ ok: false, status: 451, text: async () => "" });
    await expect(fetchReadable("https://example.com")).resolves.toBeNull();
  });

  it("throws EnrichRateLimitError on 429", async () => {
    stubFetch({ ok: false, status: 429 });
    await expect(fetchReadable("https://example.com")).rejects.toBeInstanceOf(
      EnrichRateLimitError,
    );
  });
});
