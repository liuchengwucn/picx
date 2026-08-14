/**
 * 会话侧栏的分组与时间标签。纯函数，不 import paraglide——
 * 被单测覆盖的模块一旦 import `m.*`，Node 22 会压掉 jsdom 的 localStorage 导致全红。
 * 分组标题的文案由调用方按 kind 取。
 */

export type ConversationGroupKind = "today" | "yesterday" | "week" | "month";

export interface ConversationGroup<T> {
  /** React key；月组是本地时区的 YYYY-MM，其余就是 kind 本身 */
  key: string;
  kind: ConversationGroupKind;
  /** 仅 month 组给出该月 1 号本地零点，交给 Intl.DateTimeFormat 出显示名 */
  date: Date | null;
  items: T[];
}

/**
 * now 所在本地日往前 daysAgo 天的本地零点。
 * 必须走日历减法而不是减固定的 24h——夏令时切换日只有 23 或 25 小时，
 * 用毫秒减会让「昨天」的起点偏离昨天零点约 1 小时，那一小时的会话就会被错分到
 * 相邻的桶（比如该属于「昨天」的落进「本周」）。
 * 顺序不能反：先 setDate 再归零，否则跨 DST 边界仍会落到 23:00 / 01:00。
 */
function startOfLocalDayAgo(now: number, daysAgo: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 按 updatedAt 分组。输入必须已按 updatedAt 倒序（listConversations 就是），
 * 所以只需顺序扫一遍、遇到新桶就开一组——同 groupPapersByMonth 的做法。
 * 时钟漂移导致的未来时间戳会落进「今天」，不会另开一组。
 */
export function groupConversations<T extends { updatedAt: Date }>(
  list: T[],
  now: number,
): ConversationGroup<T>[] {
  const todayStart = startOfLocalDayAgo(now, 0);
  const yesterdayStart = startOfLocalDayAgo(now, 1);
  // 「本周」= 最近 7 个自然日，今天与昨天已被前面两桶吃掉
  const weekStart = startOfLocalDayAgo(now, 6);

  const groups: ConversationGroup<T>[] = [];
  for (const item of list) {
    const ts = item.updatedAt.getTime();
    let kind: ConversationGroupKind;
    if (ts >= todayStart) kind = "today";
    else if (ts >= yesterdayStart) kind = "yesterday";
    else if (ts >= weekStart) kind = "week";
    else kind = "month";

    const d = new Date(ts);
    const key =
      kind === "month"
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        : kind;

    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.items.push(item);
      continue;
    }
    groups.push({
      key,
      kind,
      date:
        kind === "month" ? new Date(d.getFullYear(), d.getMonth(), 1) : null,
      items: [item],
    });
  }
  return groups;
}

/**
 * 行尾的时间标签，格式随组走：今天/昨天给时刻，本周给周几，更早给 MM-DD。
 * 组标题已经说了「今天」，行里再重复一遍日期是浪费那 40px。
 */
export function conversationTimeLabel(
  ts: number,
  kind: ConversationGroupKind,
  locale: string,
): string {
  const d = new Date(ts);
  if (kind === "today" || kind === "yesterday") {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  }
  if (kind === "week") {
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d);
  }
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
