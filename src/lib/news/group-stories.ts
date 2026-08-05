import type { StorySignalsSummary } from "#/db/schema";

export interface GroupableStory {
  shortId: string;
  scoreMax: number | null;
  sourceCount: number;
  signalsSummary: StorySignalsSummary | null;
  firstSeenAt: Date | string;
  earliestPublishedAt: Date | string | null;
}

export interface DayGroup<T extends GroupableStory> {
  dateKey: string; // YYYY-MM-DD（访客时区）
  date: Date;
  featured: T;
  rest: T[];
}

// en-CA 的数字短日期恰好是 YYYY-MM-DD；timeZone 仅测试时显式传，生产用浏览器本地时区
export function dateKeyOf(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function storyDate(story: GroupableStory): Date {
  return new Date(story.earliestPublishedAt ?? story.firstSeenAt);
}

// 头条优先级：scoreMax（null 视为 -1）→ sourceCount → HN points
function featuredRank(s: GroupableStory): [number, number, number] {
  return [s.scoreMax ?? -1, s.sourceCount, s.signalsSummary?.hn?.points ?? 0];
}

export function compareFeatured(a: GroupableStory, b: GroupableStory): number {
  const ra = featuredRank(a);
  const rb = featuredRank(b);
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] - rb[i];
  }
  return 0;
}

// 输入须已按时间倒序；输出组序与输入一致，组内 featured 提出、rest 保持原序
export function groupStoriesByDay<T extends GroupableStory>(
  stories: T[],
  timeZone?: string,
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const byKey = new Map<string, T[]>();
  for (const story of stories) {
    const key = dateKeyOf(storyDate(story), timeZone);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = [];
      byKey.set(key, bucket);
      groups.push({
        dateKey: key,
        date: storyDate(story),
        featured: story,
        rest: [],
      });
    }
    bucket.push(story);
  }
  for (const group of groups) {
    const bucket = byKey.get(group.dateKey) ?? [];
    let best = bucket[0];
    for (const story of bucket.slice(1)) {
      if (compareFeatured(story, best) > 0) best = story;
    }
    group.featured = best;
    group.rest = bucket.filter((story) => story !== best);
  }
  return groups;
}
