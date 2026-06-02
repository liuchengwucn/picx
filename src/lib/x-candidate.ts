// digest 每天只推 upvotes 最高的这么多篇。
export const MAX_PER_DAY = 3;
// 防洪时间窗口（小时）：只取 publishedAt 在此窗口内的论文。
export const RECENT_WINDOW_HOURS = 24;

/** 取 upvotes 最高的 MAX_PER_DAY 条（每天 top-N，也是防洪硬上限）。 */
export function capCandidates<T extends { upvotes: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.upvotes - a.upvotes).slice(0, MAX_PER_DAY);
}
