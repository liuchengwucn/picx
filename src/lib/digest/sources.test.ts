import { describe, expect, it } from "vitest";
import { parseAtomAuthors } from "./sources";

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
