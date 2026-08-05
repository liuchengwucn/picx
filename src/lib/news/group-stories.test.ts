import { describe, expect, it } from "vitest";
import type { StorySignalsSummary } from "#/db/schema";
import {
  compareFeatured,
  dateKeyOf,
  type GroupableStory,
  groupStoriesByDay,
} from "./group-stories";

const story = (over: Partial<GroupableStory> & { shortId: string }) =>
  ({
    scoreMax: null,
    sourceCount: 1,
    signalsSummary: null,
    firstSeenAt: new Date("2026-08-04T12:00:00Z"),
    earliestPublishedAt: new Date("2026-08-04T12:00:00Z"),
    ...over,
  }) satisfies GroupableStory;

describe("dateKeyOf", () => {
  it("formats YYYY-MM-DD in the given zone", () => {
    expect(dateKeyOf(new Date("2026-08-04T17:00:00Z"), "Asia/Shanghai")).toBe(
      "2026-08-05",
    );
    expect(dateKeyOf(new Date("2026-08-04T15:00:00Z"), "Asia/Shanghai")).toBe(
      "2026-08-04",
    );
  });
});

describe("groupStoriesByDay", () => {
  it("buckets across local midnight and picks featured by score", () => {
    const a = story({
      shortId: "a",
      scoreMax: 80,
      earliestPublishedAt: new Date("2026-08-04T17:00:00Z"),
    });
    const b = story({
      shortId: "b",
      scoreMax: 90,
      earliestPublishedAt: new Date("2026-08-04T18:00:00Z"),
    });
    const c = story({
      shortId: "c",
      scoreMax: 95,
      earliestPublishedAt: new Date("2026-08-04T15:00:00Z"),
    });
    const groups = groupStoriesByDay([b, a, c], "Asia/Shanghai");
    expect(groups.map((g) => g.dateKey)).toEqual(["2026-08-05", "2026-08-04"]);
    expect(groups[0].featured.shortId).toBe("b");
    expect(groups[0].rest.map((s) => s.shortId)).toEqual(["a"]);
    expect(groups[1].featured.shortId).toBe("c");
  });

  it("breaks ties by sourceCount then hn points; null score loses", () => {
    const base = { earliestPublishedAt: new Date("2026-08-04T10:00:00Z") };
    expect(
      compareFeatured(
        story({ shortId: "hi", ...base, scoreMax: 70, sourceCount: 3 }),
        story({ shortId: "lo", ...base, scoreMax: 70, sourceCount: 2 }),
      ),
    ).toBeGreaterThan(0);

    const hnSummary: StorySignalsSummary = {
      domains: [],
      hn: { points: 10, comments: 1, url: "" },
    };
    expect(
      compareFeatured(
        story({
          shortId: "hn",
          ...base,
          scoreMax: 70,
          signalsSummary: hnSummary,
        }),
        story({ shortId: "nohn", ...base, scoreMax: 70 }),
      ),
    ).toBeGreaterThan(0);

    expect(
      compareFeatured(
        story({ shortId: "null-score", ...base, scoreMax: null }),
        story({ shortId: "zero-score", ...base, scoreMax: 0 }),
      ),
    ).toBeLessThan(0);
  });

  it("keeps first occurrence as featured on full tie and preserves rest order", () => {
    const s1 = story({ shortId: "s1", scoreMax: 70 });
    const s2 = story({ shortId: "s2", scoreMax: 70 });
    const s3 = story({ shortId: "s3", scoreMax: 60 });
    const groups = groupStoriesByDay([s1, s2, s3], "Asia/Shanghai");
    expect(groups).toHaveLength(1);
    expect(groups[0].featured.shortId).toBe("s1");
    expect(groups[0].rest.map((s) => s.shortId)).toEqual(["s2", "s3"]);
  });

  it("groups preserve input order and featured is never duplicated across groups", () => {
    const day1a = story({
      shortId: "d1a",
      earliestPublishedAt: new Date("2026-08-03T10:00:00Z"),
      scoreMax: 10,
    });
    const day2a = story({
      shortId: "d2a",
      earliestPublishedAt: new Date("2026-08-04T10:00:00Z"),
      scoreMax: 20,
    });
    const day1b = story({
      shortId: "d1b",
      earliestPublishedAt: new Date("2026-08-03T11:00:00Z"),
      scoreMax: 5,
    });
    const groups = groupStoriesByDay([day1a, day2a, day1b], "Asia/Shanghai");
    expect(groups.map((g) => g.dateKey)).toEqual(["2026-08-03", "2026-08-04"]);
    const allShortIds = groups.flatMap((g) => [
      g.featured.shortId,
      ...g.rest.map((s) => s.shortId),
    ]);
    expect(new Set(allShortIds).size).toBe(allShortIds.length);
  });
});
