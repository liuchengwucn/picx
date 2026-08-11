import { describe, expect, it } from "vitest";
import { assembleTodayCards, type HomePaper, type HomeStory } from "./today";

const story = (n: number): HomeStory => ({
  shortId: `s${n}`,
  title: { en: `Story ${n}` },
  summary: { en: `Summary ${n}` },
  leadImage: null,
  publishedAt: 1_700_000_000_000 + n,
});

const paper = (n: number): HomePaper => ({
  shortId: `p${n}`,
  title: `Paper ${n}`,
  tldr: null,
  hasImage: true,
});

describe("assembleTodayCards", () => {
  it("全空: 各卡均为空态", () => {
    const cards = assembleTodayCards({ stories: [], papers: [] });
    expect(cards.headline).toBeNull();
    expect(cards.subStories).toEqual([]);
    expect(cards.latestPaper).toBeNull();
    expect(cards.galleryPicks).toEqual([]);
  });

  it("单条资讯: 只有头条, 无次级标题", () => {
    const cards = assembleTodayCards({ stories: [story(1)], papers: [] });
    expect(cards.headline?.shortId).toBe("s1");
    expect(cards.subStories).toEqual([]);
  });

  it("满量: 头条+2 次级, 论文卡与画廊精选不重复", () => {
    const cards = assembleTodayCards({
      stories: [story(1), story(2), story(3)],
      papers: [paper(1), paper(2), paper(3), paper(4)],
    });
    expect(cards.headline?.shortId).toBe("s1");
    expect(cards.subStories.map((s) => s.shortId)).toEqual(["s2", "s3"]);
    expect(cards.latestPaper?.shortId).toBe("p1");
    expect(cards.galleryPicks.map((p) => p.shortId)).toEqual([
      "p2",
      "p3",
      "p4",
    ]);
  });

  it("仅 1 篇论文: 论文卡有值, 画廊精选为空", () => {
    const cards = assembleTodayCards({ stories: [], papers: [paper(1)] });
    expect(cards.latestPaper?.shortId).toBe("p1");
    expect(cards.galleryPicks).toEqual([]);
  });
});
