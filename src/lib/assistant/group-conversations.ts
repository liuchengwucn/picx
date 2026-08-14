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

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY_MS = 86_400_000;

/**
 * 按 updatedAt 分组。输入必须已按 updatedAt 倒序（listConversations 就是），
 * 所以只需顺序扫一遍、遇到新桶就开一组——同 groupPapersByMonth 的做法。
 * 时钟漂移导致的未来时间戳会落进「今天」，不会另开一组。
 */
export function groupConversations<T extends { updatedAt: Date }>(
  list: T[],
  now: number,
): ConversationGroup<T>[] {
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = todayStart - DAY_MS;
  // 「本周」= 最近 7 个自然日，今天与昨天已被前面两桶吃掉
  const weekStart = todayStart - 6 * DAY_MS;

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
