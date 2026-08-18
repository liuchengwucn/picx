// 每次 cron 触发最多直发 upvotes 最高的这么多篇（= 1，成本与防洪硬上限）。
// 配合每天 3 次触发（22:00 / 22:30 / 23:00），每次发剩余 top-1 → 全天发出当天 top-3。
export const MAX_PER_DAY = 1;
// 防洪时间窗口（小时）：只取 publishedAt 在此窗口内的论文。
export const RECENT_WINDOW_HOURS = 24;

/** 取 upvotes 最高的 MAX_PER_DAY 条（单次触发的 top-N，也是防洪硬上限）。 */
export function capCandidates<T extends { upvotes: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.upvotes - a.upvotes).slice(0, MAX_PER_DAY);
}

// digest picks 候选窗口（天）：只取出刊时间在此窗口内的 published 期的 picks。
// 周六出刊 + 1 天容错；是防洪护栏一（24h 窗口）在 digest 来源上的替代形态。
export const DIGEST_WINDOW_DAYS = 8;

/**
 * 从 arXiv URL 解析论文月龄（相对 at）；非 arXiv 或解析失败返回 null。
 * 与 src/lib/digest/store.ts 的 yymm 裁定同一口径（月历差，正数=过去），用于
 * 给发推 digest 回退再加一道论文年龄闸——digest picks 正常全是 arXiv 且已过
 * MAX_CANDIDATE_AGE_MONTHS 闸，这里只是防线：万一未来 pick 来源变化，非
 * arXiv/解析失败一律 fail-closed 丢弃，不放行未知年龄的候选。
 */
export function arxivAgeMonths(url: string, at: Date): number | null {
  const m = url.match(/arxiv\.org\/abs\/(\d{2})(\d{2})\./);
  if (!m) return null;
  const yy = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  const year = 2000 + yy;
  return (at.getUTCFullYear() - year) * 12 + (at.getUTCMonth() + 1 - mm);
}

/** digest picks 候选行（SQL join 后、JS 去重排序前的最小形状）。 */
export interface DigestCandidateRow {
  paperId: string;
  rank: number;
  digestPublishedAtMs: number;
}

/**
 * digest picks 候选的去重与排序：
 * 同一论文被多期/多方向选中时保留 rank 最小的行（rank 相同保留出刊更新的行，
 * 双双相同时保留任一行——只影响哪条推荐语存活，不作保证）；
 * 全序 rank ASC → 出刊时间 DESC → paperId ASC，保证确定性。
 * rank 是每期编辑排名：各方向的 rank-1 先发完才轮到 rank-2，天然做到方向轮转公平。
 */
export function selectDigestCandidates<T extends DigestCandidateRow>(
  rows: T[],
): T[] {
  const byPaper = new Map<string, T>();
  for (const row of rows) {
    const prev = byPaper.get(row.paperId);
    if (
      !prev ||
      row.rank < prev.rank ||
      (row.rank === prev.rank &&
        row.digestPublishedAtMs > prev.digestPublishedAtMs)
    ) {
      byPaper.set(row.paperId, row);
    }
  }
  return [...byPaper.values()].sort(
    (a, b) =>
      a.rank - b.rank ||
      b.digestPublishedAtMs - a.digestPublishedAtMs ||
      a.paperId.localeCompare(b.paperId),
  );
}
