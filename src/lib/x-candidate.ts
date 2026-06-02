// 发推质量阈值（SQL WHERE 用）。低于此 upvotes 不发，过滤 arxiv-cron 的补位低分论文。
export const TWEET_MIN_UPVOTES = 30;
// 防洪硬上限：candidate 单次最多入队这么多条。
export const MAX_PER_DAY = 8;
// 防洪时间窗口（小时）：只取 publishedAt 在此窗口内的论文。
export const RECENT_WINDOW_HOURS = 24;

/** 防洪兜底：即便 SQL 返回过多，也只保留 upvotes 最高的 MAX_PER_DAY 条。 */
export function capCandidates<T extends { upvotes: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.upvotes - a.upvotes).slice(0, MAX_PER_DAY);
}
