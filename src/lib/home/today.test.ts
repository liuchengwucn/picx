import { describe, expect, it } from "vitest";
import {
  assembleTodayCards,
  type HomePaper,
  type HomeStory,
  selectTodayStories,
} from "./today";

const story = (n: number): HomeStory => ({
  shortId: `s${n}`,
  title: { en: `Story ${n}` },
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

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

interface Candidate {
  shortId: string;
  scoreMax: number | null;
  sourceCount: number;
  signalsSummary: null;
  firstSeenAt: Date;
  earliestPublishedAt: Date;
}

// hoursAgo 越小越新; 调用方须按时间倒序排列传入
const candidate = (
  shortId: string,
  hoursAgo: number,
  scoreMax: number | null,
  sourceCount = 1,
): Candidate => ({
  shortId,
  scoreMax,
  sourceCount,
  signalsSummary: null,
  firstSeenAt: new Date(NOW - hoursAgo * HOUR),
  earliestPublishedAt: new Date(NOW - hoursAgo * HOUR),
});

describe("selectTodayStories", () => {
  it("24h 窗口内选最高分而非最新", () => {
    const list = [
      candidate("a", 1, 60),
      candidate("b", 5, 95),
      candidate("c", 10, 70),
    ];
    expect(selectTodayStories(list, NOW).map((s) => s.shortId)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("分数并列时按 sourceCount 决胜", () => {
    const list = [
      candidate("a", 1, 90, 2),
      candidate("b", 5, 90, 6),
      candidate("c", 10, 50),
    ];
    expect(selectTodayStories(list, NOW)[0]?.shortId).toBe("b");
  });

  it("窗口内不足 3 条时放宽到全池", () => {
    const list = [
      candidate("a", 1, 40),
      candidate("b", 30, 99),
      candidate("c", 40, 80),
    ];
    expect(selectTodayStories(list, NOW).map((s) => s.shortId)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("窗口外旧闻不参与头条(窗口内够 3 条)", () => {
    const list = [
      candidate("a", 1, 50),
      candidate("b", 2, 70),
      candidate("c", 3, 60),
      candidate("d", 48, 99),
    ];
    expect(selectTodayStories(list, NOW).map((s) => s.shortId)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("空候选返回 []", () => {
    expect(selectTodayStories([], NOW)).toEqual([]);
  });
});
