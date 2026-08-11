import { describe, expect, it } from "vitest";
import {
  addRecentPaper,
  parseRecentPapers,
  RECENT_PAPERS_LIMIT,
  type RecentPaper,
} from "./recent-papers";

const entry = (shortId: string, openedAt: number): RecentPaper => ({
  shortId,
  title: `Paper ${shortId}`,
  openedAt,
});

describe("parseRecentPapers", () => {
  it("returns empty for null / invalid json / non-array", () => {
    expect(parseRecentPapers(null)).toEqual([]);
    expect(parseRecentPapers("{ not json")).toEqual([]);
    expect(parseRecentPapers('{"a":1}')).toEqual([]);
  });

  it("drops malformed entries but keeps valid ones", () => {
    const raw = JSON.stringify([
      entry("aaa", 3),
      { shortId: "bbb" },
      { shortId: "", title: "x", openedAt: 1 },
      entry("ccc", 1),
    ]);
    expect(parseRecentPapers(raw).map((p) => p.shortId)).toEqual([
      "aaa",
      "ccc",
    ]);
  });

  it("sorts by openedAt desc and truncates to the limit", () => {
    const raw = JSON.stringify([
      entry("a", 1),
      entry("b", 5),
      entry("c", 3),
      entry("d", 4),
    ]);
    expect(parseRecentPapers(raw).map((p) => p.shortId)).toEqual([
      "b",
      "d",
      "c",
    ]);
    expect(parseRecentPapers(raw)).toHaveLength(RECENT_PAPERS_LIMIT);
  });
});

describe("addRecentPaper", () => {
  it("puts the new entry first", () => {
    const list = [entry("a", 1)];
    expect(addRecentPaper(list, entry("b", 2)).map((p) => p.shortId)).toEqual([
      "b",
      "a",
    ]);
  });

  it("dedupes by shortId instead of growing", () => {
    const list = [entry("a", 1), entry("b", 2)];
    const next = addRecentPaper(list, entry("a", 9));
    expect(next.map((p) => p.shortId)).toEqual(["a", "b"]);
    expect(next[0].openedAt).toBe(9);
  });

  it("truncates to the limit", () => {
    const list = [entry("a", 1), entry("b", 2), entry("c", 3)];
    expect(addRecentPaper(list, entry("d", 4))).toHaveLength(
      RECENT_PAPERS_LIMIT,
    );
    expect(addRecentPaper(list, entry("d", 4)).map((p) => p.shortId)).toEqual([
      "d",
      "a",
      "b",
    ]);
  });
});
