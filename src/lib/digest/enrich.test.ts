import { describe, expect, it } from "vitest";
import { buildAuthorSignals, type S2Paper } from "./enrich";

const URL_A = "https://arxiv.org/abs/2508.00001";
const URL_B = "https://arxiv.org/abs/2508.00002";

describe("buildAuthorSignals", () => {
  it("maps a normal row to first/last/max metrics", () => {
    const rows: Array<S2Paper | null> = [
      {
        authors: [
          { name: "First A", hIndex: 3, citationCount: 245 },
          { name: "Mid B", hIndex: 61, citationCount: 30000 },
          { name: "Last C", hIndex: 52, citationCount: 18340 },
        ],
      },
    ];
    expect(buildAuthorSignals([URL_A], rows)).toEqual({
      [URL_A]: {
        first: { name: "First A", hIndex: 3, citations: 245 },
        last: { name: "Last C", hIndex: 52, citations: 18340 },
        maxHIndex: 61,
        totalAuthors: 3,
      },
    });
  });

  it("skips null rows (not indexed) and rows with empty authors", () => {
    expect(buildAuthorSignals([URL_A, URL_B], [null, { authors: [] }])).toEqual(
      {},
    );
  });

  it("keeps null hIndex/citations as null (new researcher), max over the rest", () => {
    const rows: Array<S2Paper | null> = [
      {
        authors: [
          { name: "Newbie", hIndex: null, citationCount: null },
          { name: "Prof", hIndex: 40, citationCount: 9000 },
        ],
      },
    ];
    const s = buildAuthorSignals([URL_A], rows)[URL_A];
    expect(s.first).toEqual({ name: "Newbie", hIndex: null, citations: null });
    expect(s.maxHIndex).toBe(40);
  });

  it("single author: first equals last, max from that author", () => {
    const rows: Array<S2Paper | null> = [
      { authors: [{ name: "Solo", hIndex: 7, citationCount: 100 }] },
    ];
    const s = buildAuthorSignals([URL_A], rows)[URL_A];
    expect(s.first).toEqual(s.last);
    expect(s.totalAuthors).toBe(1);
    expect(s.maxHIndex).toBe(7);
  });

  it("tolerates a response shorter than the input (out-of-range = missing)", () => {
    expect(buildAuthorSignals([URL_A, URL_B], [null])).toEqual({});
  });

  it("yields null maxHIndex when every hIndex is null", () => {
    const rows: Array<S2Paper | null> = [
      { authors: [{ name: "X", hIndex: null, citationCount: 5 }] },
    ];
    expect(buildAuthorSignals([URL_A], rows)[URL_A].maxHIndex).toBeNull();
  });
});
