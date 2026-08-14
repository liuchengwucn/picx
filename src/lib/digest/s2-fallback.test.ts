import { afterEach, describe, expect, it, vi } from "vitest";
import {
  arxivQueryToS2Query,
  fetchS2Fallback,
  type S2SearchRow,
  s2RowsToCandidates,
} from "./s2-fallback";

describe("arxivQueryToS2Query", () => {
  it("strips cat: terms entirely", () => {
    expect(arxivQueryToS2Query("cat:cs.AI")).toBe("");
  });

  it("strips cat: alongside a joined AND clause", () => {
    expect(arxivQueryToS2Query("cat:cs.LO AND abs:formalization")).toBe(
      "formalization",
    );
  });

  it("strips ti:/abs:/all: field prefixes while keeping their values", () => {
    expect(arxivQueryToS2Query("ti:kernel")).toBe("kernel");
    expect(arxivQueryToS2Query("abs:kernel")).toBe("kernel");
    expect(arxivQueryToS2Query("all:kernel")).toBe("kernel");
  });

  it("maps AND to a space", () => {
    expect(arxivQueryToS2Query("abs:kernel AND abs:transformer")).toBe(
      "kernel transformer",
    );
  });

  it("maps OR to |", () => {
    expect(arxivQueryToS2Query("abs:kernel OR abs:transformer")).toBe(
      "kernel | transformer",
    );
  });

  it("maps ANDNOT to -", () => {
    expect(arxivQueryToS2Query("abs:kernel ANDNOT abs:transformer")).toBe(
      "kernel - transformer",
    );
  });

  it("preserves quoted phrases", () => {
    expect(arxivQueryToS2Query('ti:"linear attention"')).toBe(
      '"linear attention"',
    );
  });

  it("preserves parentheses and cleans up dangling operators left by stripped cat: terms", () => {
    expect(
      arxivQueryToS2Query(
        'cat:cs.CL AND (ti:"linear attention" OR abs:kernel)',
      ),
    ).toBe('("linear attention" | kernel)');
  });

  it("cleans up nested dangling operators from cat: terms inside parens", () => {
    expect(
      arxivQueryToS2Query("(cat:cs.AI OR cat:cs.LG) AND abs:representation"),
    ).toBe("representation");
  });
});

describe("s2RowsToCandidates", () => {
  const windowStart = new Date("2026-08-01T00:00:00.000Z");

  it("drops rows without an ArXiv external id", () => {
    const rows: S2SearchRow[] = [
      { title: "no arxiv id", externalIds: {} },
      { title: "null externalIds", externalIds: null },
    ];
    expect(s2RowsToCandidates(rows, "test-source", windowStart)).toEqual([]);
  });

  it("drops rows published before windowStart", () => {
    const rows: S2SearchRow[] = [
      {
        title: "too old",
        externalIds: { ArXiv: "2607.00001" },
        publicationDate: "2026-07-01",
      },
    ];
    expect(s2RowsToCandidates(rows, "test-source", windowStart)).toEqual([]);
  });

  it("keeps rows with a null publicationDate and omits publishedAt", () => {
    const rows: S2SearchRow[] = [
      { title: "no date", externalIds: { ArXiv: "2608.00001" } },
    ];
    const result = s2RowsToCandidates(rows, "test-source", windowStart);
    expect(result).toHaveLength(1);
    expect(result[0].publishedAt).toBeUndefined();
    expect(result[0]).not.toHaveProperty("publishedAt");
  });

  it("truncates the excerpt to MAX_EXCERPT (1200) chars", () => {
    const longAbstract = "a".repeat(2000);
    const rows: S2SearchRow[] = [
      {
        title: "long abstract",
        externalIds: { ArXiv: "2608.00002" },
        abstract: longAbstract,
      },
    ];
    const result = s2RowsToCandidates(rows, "test-source", windowStart);
    expect(result[0].excerpt).toHaveLength(1200);
  });

  it("builds a canonical arxiv.org/abs URL", () => {
    const rows: S2SearchRow[] = [
      {
        title: "canonical url",
        externalIds: { ArXiv: "2608.00003v2" },
        publicationDate: "2026-08-10",
      },
    ];
    const result = s2RowsToCandidates(rows, "test-source", windowStart);
    expect(result[0].canonicalUrl).toBe("https://arxiv.org/abs/2608.00003");
    expect(result[0].sourceLabel).toBe("test-source");
    expect(result[0].kind).toBe("paper");
  });
});

describe("fetchS2Fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const windowStart = new Date("2026-08-01T00:00:00.000Z");

  it("throws when config.query is missing", async () => {
    await expect(
      fetchS2Fallback({}, windowStart, "test-source"),
    ).rejects.toThrow("missing config.query");
  });

  it("throws when the mapped query is empty (category-only source)", async () => {
    await expect(
      fetchS2Fallback({ query: "cat:cs.AI" }, windowStart, "test-source"),
    ).rejects.toThrow("mapped query is empty");
  });

  it("parses a 200 response into candidates", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        total: 1,
        token: null,
        data: [
          {
            title: "A Paper",
            abstract: "An abstract",
            publicationDate: "2026-08-10",
            externalIds: { ArXiv: "2608.00004" },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchS2Fallback(
      { query: "abs:kernel", maxResults: 10 },
      windowStart,
      "test-source",
      "test-key",
    );
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("A Paper");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["x-api-key"]).toBe("test-key");
  });

  it("rejects on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({}),
      }),
    );
    await expect(
      fetchS2Fallback({ query: "abs:kernel" }, windowStart, "test-source"),
    ).rejects.toThrow("429");
  });

  it("rejects when the response has no data array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ total: 0, token: null }),
      }),
    );
    await expect(
      fetchS2Fallback({ query: "abs:kernel" }, windowStart, "test-source"),
    ).rejects.toThrow("unrecognized response");
  });
});
