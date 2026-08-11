/**
 * 列表页按月分组。分组只是加个标题,组内顺序恒定 —— 不要照抄 news 的
 * 「扣留最后一天不渲染」逻辑,那是为了防止头条随下一批数据重排,本页没有
 * 头条概念,照抄纯属白白引入复杂度。
 */

export interface PaperMonthGroup<T> {
  /** 本地时区的 YYYY-MM,仅作 React key 与去重用 */
  monthKey: string;
  /** 该月 1 号本地零点,交给 Intl.DateTimeFormat 出显示名 */
  date: Date;
  papers: T[];
}

/** 本地时区的 YYYY-MM。用本地时区是因为分组标题给人看,不是给机器对齐时间轴。 */
export function monthKeyOf(input: Date | string): string {
  const d = input instanceof Date ? input : new Date(input);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function groupPapersByMonth<T extends { createdAt: Date | string }>(
  list: T[],
): PaperMonthGroup<T>[] {
  const groups: PaperMonthGroup<T>[] = [];
  for (const paper of list) {
    const monthKey = monthKeyOf(paper.createdAt);
    const last = groups[groups.length - 1];
    if (last?.monthKey === monthKey) {
      last.papers.push(paper);
      continue;
    }
    const d =
      paper.createdAt instanceof Date
        ? paper.createdAt
        : new Date(paper.createdAt);
    groups.push({
      monthKey,
      date: new Date(d.getFullYear(), d.getMonth(), 1),
      papers: [paper],
    });
  }
  return groups;
}
