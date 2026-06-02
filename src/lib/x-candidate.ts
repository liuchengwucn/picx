// 每次 cron 触发最多直发 upvotes 最高的这么多篇（= 1，成本与防洪硬上限）。
// 配合每天 3 次触发（22:00 / 22:30 / 23:00），每次发剩余 top-1 → 全天发出当天 top-3。
export const MAX_PER_DAY = 1;
// 防洪时间窗口（小时）：只取 publishedAt 在此窗口内的论文。
export const RECENT_WINDOW_HOURS = 24;

/** 取 upvotes 最高的 MAX_PER_DAY 条（单次触发的 top-N，也是防洪硬上限）。 */
export function capCandidates<T extends { upvotes: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.upvotes - a.upvotes).slice(0, MAX_PER_DAY);
}
