import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArxivRateLimitError,
  dehyphenateWrappedTitle,
  fetchArxivQuery,
  parseAtomAuthors,
} from "./sources";

describe("dehyphenateWrappedTitle", () => {
  it("rejoins a hyphen immediately followed by a line break", () => {
    expect(dehyphenateWrappedTitle("ATTEN-\n TION mechanisms")).toBe(
      "ATTENTION mechanisms",
    );
  });

  it("keeps a suspended hyphen unchanged when the break is followed by and/or", () => {
    expect(dehyphenateWrappedTitle("Intra-\n and Inter-Layer Attention")).toBe(
      "Intra-\n and Inter-Layer Attention",
    );
  });

  it("leaves a plain hyphenated word (no line break) unchanged", () => {
    expect(dehyphenateWrappedTitle("Test-Time Training")).toBe(
      "Test-Time Training",
    );
  });

  it("leaves a plain wrap without a hyphen unchanged", () => {
    expect(dehyphenateWrappedTitle("Sparse\n Attention")).toBe(
      "Sparse\n Attention",
    );
  });

  it("leaves a hyphen followed by a plain space (no line break) unchanged", () => {
    expect(dehyphenateWrappedTitle("ATTEN- TION")).toBe("ATTEN- TION");
  });
});

describe("parseAtomAuthors", () => {
  it("returns empty object when entry has no authors", () => {
    expect(parseAtomAuthors({})).toEqual({});
  });

  it("parses a single author object (fast-xml-parser unwraps single-element arrays)", () => {
    expect(parseAtomAuthors({ author: { name: "Alice Chen" } })).toEqual({
      authors: ["Alice Chen"],
      authorCount: 1,
    });
  });

  it("keeps all authors when count is at most 6", () => {
    const entry = {
      author: ["A", "B", "C", "D", "E", "F"].map((n) => ({ name: n })),
    };
    expect(parseAtomAuthors(entry)).toEqual({
      authors: ["A", "B", "C", "D", "E", "F"],
      authorCount: 6,
    });
  });

  it("truncates more than 6 authors to first 5 + last, keeping the true total", () => {
    const entry = {
      author: ["A", "B", "C", "D", "E", "F", "G", "H"].map((n) => ({
        name: n,
      })),
    };
    expect(parseAtomAuthors(entry)).toEqual({
      authors: ["A", "B", "C", "D", "E", "H"],
      authorCount: 8,
    });
  });

  it("skips malformed author nodes and blank names", () => {
    const entry = { author: [{ name: "A" }, {}, "junk", { name: "  " }] };
    expect(parseAtomAuthors(entry)).toEqual({
      authors: ["A"],
      authorCount: 1,
    });
  });
});

describe("fetchArxivQuery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects with ArxivRateLimitError on 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "",
      }),
    );
    await expect(
      fetchArxivQuery({ query: "cat:cs.AI" }, new Date(0), "test-source"),
    ).rejects.toBeInstanceOf(ArxivRateLimitError);
  });

  it("rejects with a plain Error (not ArxivRateLimitError) on 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "",
      }),
    );
    const promise = fetchArxivQuery(
      { query: "cat:cs.AI" },
      new Date(0),
      "test-source",
    );
    await expect(promise).rejects.toBeInstanceOf(Error);
    await expect(promise).rejects.not.toBeInstanceOf(ArxivRateLimitError);
  });
});
