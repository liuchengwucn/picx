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

  it("drops an ANDNOT clause (single field:value token) entirely instead of mapping to a space-separated dash", () => {
    // space-separated "- term" was found to make S2 bulk search silently
    // return 0 results (200 OK, no error) — dropping the whole clause is
    // the safer downgrade, negative filtering is left to downstream prescore
    expect(arxivQueryToS2Query("abs:kernel ANDNOT abs:transformer")).toBe(
      "kernel",
    );
  });

  it("drops an ANDNOT clause (parenthesized group) entirely", () => {
    expect(
      arxivQueryToS2Query("abs:kernel ANDNOT (ti:survey OR ti:review)"),
    ).toBe("kernel");
  });

  it("normalizes to an empty string when the whole query is a dropped ANDNOT clause plus a cat: term", () => {
    expect(
      arxivQueryToS2Query("cat:cs.LG ANDNOT (ti:survey OR ti:review)"),
    ).toBe("");
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

  it("keeps rows published on windowStart's calendar day even when windowStart carries a time-of-day", () => {
    // windowStart is derived from a cron timestamp (e.g. 12:00 UTC), but S2
    // publicationDate is day-granularity — comparing against the raw
    // windowStart instant would drop every paper published that same day
    // and permanently lose them (next week's window won't cover them either)
    const cronWindowStart = new Date("2026-08-01T12:00:00.000Z");
    const rows: S2SearchRow[] = [
      {
        title: "published on window start day",
        externalIds: { ArXiv: "2608.00005" },
        publicationDate: "2026-08-01",
      },
    ];
    const result = s2RowsToCandidates(rows, "test-source", cronWindowStart);
    expect(result).toHaveLength(1);
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

  it("throws when the mapped query has no searchable text (category-only source)", async () => {
    await expect(
      fetchS2Fallback({ query: "cat:cs.AI" }, windowStart, "test-source"),
    ).rejects.toThrow("no searchable text after mapping");
  });

  it("throws when the mapped query has no searchable text (fully-negated ANDNOT source)", async () => {
    await expect(
      fetchS2Fallback(
        { query: "cat:cs.LG ANDNOT (ti:survey OR ti:review)" },
        windowStart,
        "test-source",
      ),
    ).rejects.toThrow("no searchable text after mapping");
  });

  it("parses a 200 response into candidates and builds the request URL correctly", async () => {
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
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.headers["x-api-key"]).toBe("test-key");
    expect(url).toContain("query=kernel");
    expect(url).toContain("publicationDateOrYear=2026-08-01:");
    expect(url).toContain("sort=publicationDate:desc");
    expect(url).toContain("limit=10");
  });

  it("returns an empty array when data is an empty array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ total: 0, token: null, data: [] }),
      }),
    );
    const result = await fetchS2Fallback(
      { query: "abs:kernel" },
      windowStart,
      "test-source",
    );
    expect(result).toEqual([]);
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
