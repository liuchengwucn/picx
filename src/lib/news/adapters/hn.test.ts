import { describe, expect, it } from "vitest";
import { hitToItem } from "./hn";

describe("hitToItem", () => {
  it("maps external-link story", () => {
    const item = hitToItem({
      objectID: "1",
      title: "T",
      url: "https://a.com/x",
      points: 120,
      num_comments: 40,
      author: "pg",
      created_at_i: 1700000000,
    });
    expect(item).toMatchObject({
      url: "https://a.com/x",
      signals: { points: 120, comments: 40 },
      extra: { hnId: "1", hnUrl: "https://news.ycombinator.com/item?id=1" },
    });
  });
  it("falls back to HN url for Ask HN, drops titleless", () => {
    expect(
      hitToItem({
        objectID: "2",
        title: "Ask HN",
        url: null,
        points: 5,
        num_comments: 1,
        author: "a",
        created_at_i: 1700000000,
      })?.url,
    ).toBe("https://news.ycombinator.com/item?id=2");
    expect(
      hitToItem({
        objectID: "3",
        title: null,
        url: null,
        points: 0,
        num_comments: 0,
        author: "a",
        created_at_i: 0,
      }),
    ).toBeNull();
  });
});
