import { describe, expect, it } from "vitest";
import type { StorySignalsSummary } from "#/db/schema";
import {
  assembleTodayCards,
  type HomeEdition,
  type HomePaper,
  type HomeStory,
  pickTopStories,
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

// 分配只看 edition 是否为 null, 字段值本身不参与判断, 给一份最小合法对象即可
const edition = (): HomeEdition => ({
  periodStart: 1_700_000_000_000,
  periodEnd: 1_700_600_000_000,
  activeDirectionCount: 7,
  directionCount: 7,
  pickCount: 63,
  highlights: [],
  otherDirectionNames: [],
});

describe("assembleTodayCards", () => {
  it("全空: 各卡均为空态", () => {
    const cards = assembleTodayCards({
      stories: [],
      papers: [],
      edition: null,
    });
    expect(cards.headline).toBeNull();
    expect(cards.subStories).toEqual([]);
    expect(cards.latestPaper).toBeNull();
    expect(cards.relatedPapers).toEqual([]);
    expect(cards.galleryPicks).toEqual([]);
  });

  it("单条资讯: 只有头条, 无次级标题", () => {
    const cards = assembleTodayCards({
      stories: [story(1)],
      papers: [],
      edition: null,
    });
    expect(cards.headline?.shortId).toBe("s1");
    expect(cards.subStories).toEqual([]);
  });

  it("有合刊: 次要论文归论文卡底座, 画廊精选让位", () => {
    const cards = assembleTodayCards({
      stories: [story(1), story(2), story(3), story(4), story(5), story(6)],
      papers: [paper(1), paper(2), paper(3), paper(4)],
      edition: edition(),
    });
    expect(cards.headline?.shortId).toBe("s1");
    expect(cards.subStories.map((s) => s.shortId)).toEqual([
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
    ]);
    expect(cards.latestPaper?.shortId).toBe("p1");
    expect(cards.relatedPapers.map((p) => p.shortId)).toEqual(["p2", "p3"]);
    expect(cards.galleryPicks).toEqual([]);
  });

  it("无合刊(fallback): 画廊精选取 3 篇, 论文卡不挂次要论文", () => {
    const cards = assembleTodayCards({
      stories: [],
      papers: [paper(1), paper(2), paper(3), paper(4)],
      edition: null,
    });
    expect(cards.latestPaper?.shortId).toBe("p1");
    expect(cards.relatedPapers).toEqual([]);
    expect(cards.galleryPicks.map((p) => p.shortId)).toEqual([
      "p2",
      "p3",
      "p4",
    ]);
  });

  // 这条是本次改动真正的回归风险: 两张卡都从 papers[1..] 取, 无条件分配会让同一篇
  // 论文在首页出现两次。两个分支都断言一遍。
  it.each([
    { name: "有合刊", ed: edition() },
    { name: "无合刊", ed: null },
  ])("$name: 论文卡与画廊精选永不重复同一篇", ({ ed }) => {
    const cards = assembleTodayCards({
      stories: [],
      papers: [paper(1), paper(2), paper(3), paper(4)],
      edition: ed,
    });
    const shown = [
      cards.latestPaper?.shortId,
      ...cards.relatedPapers.map((p) => p.shortId),
      ...cards.galleryPicks.map((p) => p.shortId),
    ].filter(Boolean);
    expect(new Set(shown).size).toBe(shown.length);
  });

  it("仅 1 篇论文: 论文卡有值, 其余为空", () => {
    const cards = assembleTodayCards({
      stories: [],
      papers: [paper(1)],
      edition: edition(),
    });
    expect(cards.latestPaper?.shortId).toBe("p1");
    expect(cards.relatedPapers).toEqual([]);
    expect(cards.galleryPicks).toEqual([]);
  });
});

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

interface Candidate {
  shortId: string;
  scoreMax: number | null;
  sourceCount: number;
  signalsSummary: StorySignalsSummary | null;
  firstSeenAt: Date;
  earliestPublishedAt: Date;
}

const signals = (points: number): StorySignalsSummary => ({
  domains: [],
  hn: { points, comments: 0, url: "" },
});

// hoursAgo 越小越新; 用于构造固定时间戳, 排序断言不依赖它
const candidate = (
  shortId: string,
  scoreMax: number | null,
  sourceCount = 1,
  signalsSummary: StorySignalsSummary | null = null,
  hoursAgo = 1,
): Candidate => ({
  shortId,
  scoreMax,
  sourceCount,
  signalsSummary,
  firstSeenAt: new Date(NOW - hoursAgo * HOUR),
  earliestPublishedAt: new Date(NOW - hoursAgo * HOUR),
});

describe("pickTopStories", () => {
  it("乱序候选按分数取 top-N", () => {
    const list = [
      candidate("a", 60),
      candidate("b", 95),
      candidate("c", 70),
      candidate("d", 88),
    ];
    expect(pickTopStories(list, 3).map((s) => s.shortId)).toEqual([
      "b",
      "d",
      "c",
    ]);
  });

  it("分数并列按 sourceCount 决胜", () => {
    const list = [candidate("a", 90, 2), candidate("b", 90, 6)];
    expect(pickTopStories(list, 2).map((s) => s.shortId)).toEqual(["b", "a"]);
  });

  it("再并列按 HN points 决胜", () => {
    const list = [
      candidate("a", 90, 3, signals(10)),
      candidate("b", 90, 3, signals(200)),
    ];
    expect(pickTopStories(list, 2).map((s) => s.shortId)).toEqual(["b", "a"]);
  });

  it("count 超出候选数返回全部(仍按分数序)", () => {
    const list = [candidate("a", 60), candidate("b", 90)];
    expect(pickTopStories(list, 6).map((s) => s.shortId)).toEqual(["b", "a"]);
  });

  it("空候选返回 []", () => {
    expect(pickTopStories([], 6)).toEqual([]);
  });
});
