import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArxivRateLimitError,
  fetchArxivQuery,
  parseAtomAuthors,
} from "./sources";

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
