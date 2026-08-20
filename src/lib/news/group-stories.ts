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
  // ≥80 分但不是当天最高分的 story：介于大头条与普通行之间的「次头条」档
  subFeatured: T[];
  rest: T[];
}

// scoreMax 达到该阈值的 story 进当天头条区；无达标者退回单条最高分。
// 2026-08-20 由 80 下调至 70：8/13 的打分降权改动压低了整体分数，80 在新分布下
// 近乎架空（近五日有四日一条次头条都没有）。按生产数据校准到「每天 2-3 条次头条」。
export const FEATURED_SCORE_MIN = 70;
// 次头条条数上限。日产量波动约 3 倍，单靠阈值无法稳定命中 2-3 条：阈值定低了
// 繁忙日会冒出六七条，定高了清淡日一条没有。上限负责压住上沿，阈值负责保住质量下限。
export const MAX_SUB_FEATURED = 3;

// en-CA 的数字短日期恰好是 YYYY-MM-DD；timeZone 仅测试时显式传，生产用浏览器本地时区
// Intl.DateTimeFormat 构造开销大，按 timeZone 缓存实例（300 条实测 8ms→0.17ms）
const fmtCache = new Map<string, Intl.DateTimeFormat>();

export function dateKeyOf(date: Date, timeZone?: string): string {
  const key = timeZone ?? "";
  let fmt = fmtCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    fmtCache.set(key, fmt);
  }
  return fmt.format(date);
}

export function storyDate(story: GroupableStory): Date {
  return new Date(story.earliestPublishedAt ?? story.firstSeenAt);
}

// 大头条优先级：scoreMax（null 视为 -1）→ sourceCount → HN points
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
        subFeatured: [],
        rest: [],
      });
    }
    bucket.push(story);
  }
  for (const group of groups) {
    const bucket = byKey.get(group.dateKey) ?? [];
    // ≥80 分的全部进头条区；全天无达标者头条区兜底为整个 bucket 里的最高分一条
    const candidates = bucket.filter(
      (story) => (story.scoreMax ?? -1) >= FEATURED_SCORE_MIN,
    );
    const pool = candidates.length > 0 ? candidates : bucket;
    let best = pool[0];
    for (const story of pool.slice(1)) {
      if (compareFeatured(story, best) > 0) best = story;
    }
    group.featured = best;
    // 次头条按头条优先级取前 MAX_SUB_FEATURED 条，落选者由下面的 promoted 反算
    // 自动回到 rest（不会凭空消失）。挑完再按输入的时间倒序展示，与 rest 一致。
    const others = candidates.filter((story) => story !== best);
    const picked = new Set(
      [...others]
        .sort((a, b) => compareFeatured(b, a))
        .slice(0, MAX_SUB_FEATURED),
    );
    group.subFeatured = others.filter((story) => picked.has(story));
    const promoted = new Set<GroupableStory>([best, ...group.subFeatured]);
    group.rest = bucket.filter((story) => !promoted.has(story));
  }
  return groups;
}
