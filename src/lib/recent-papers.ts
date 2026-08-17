/**
 * 「最近打开」的本地记录。只收自己的论文 —— 这三张卡是 /papers(自己的论文列表)
 * 的快捷入口,画廊里别人的论文混进来会让它变成一份来路不明的浏览历史。
 * 归属判断在写入侧(见 routes/p/$shortId.tsx),这里只管存取。
 *
 * 刻意不落库:
 * 让用户维护阅读进度是额外心智负担,而「我刚才在这台机器上读什么」这个场景
 * 本来也不需要跨设备同步。
 *
 * 存 title 快照而不是只存 shortId: 最近打开的论文很可能不在当前筛选结果里,
 * 没法从列表数据反查标题。代价是用户改标题后卡片显示旧标题 —— 论文标题基本
 * 不变,可接受。
 */

export const RECENT_PAPERS_KEY = "picx:recent-papers:v2";
/**
 * v1 记过任何打开过的论文（含画廊里别人的）。那些记录里没有归属信息，事后没法
 * 筛；而改成只记自己的论文之后，也不再有新记录去把它们挤掉。整体作废最干净。
 */
const RECENT_PAPERS_LEGACY_KEY = "picx:recent-papers";
export const RECENT_PAPERS_LIMIT = 3;

export interface RecentPaper {
  shortId: string;
  title: string;
  openedAt: number;
}

function isRecentPaper(value: unknown): value is RecentPaper {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.shortId === "string" &&
    v.shortId.length > 0 &&
    typeof v.title === "string" &&
    typeof v.openedAt === "number" &&
    Number.isFinite(v.openedAt)
  );
}

/** 解析 localStorage 原文。任何脏数据都退化成空列表,绝不抛错。 */
export function parseRecentPapers(raw: string | null): RecentPaper[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isRecentPaper)
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, RECENT_PAPERS_LIMIT);
}

/** 把一条记录置顶并按 shortId 去重,截断到上限。纯函数,不碰 localStorage。 */
export function addRecentPaper(
  list: RecentPaper[],
  entry: RecentPaper,
): RecentPaper[] {
  return [entry, ...list.filter((p) => p.shortId !== entry.shortId)].slice(
    0,
    RECENT_PAPERS_LIMIT,
  );
}

export function readRecentPapers(): RecentPaper[] {
  if (typeof window === "undefined") return [];
  try {
    return parseRecentPapers(window.localStorage.getItem(RECENT_PAPERS_KEY));
  } catch {
    // 隐私模式 / 配额满时 localStorage 会抛
    return [];
  }
}

export function pushRecentPaper(entry: RecentPaper): void {
  if (typeof window === "undefined") return;
  try {
    const next = addRecentPaper(readRecentPapers(), entry);
    window.localStorage.setItem(RECENT_PAPERS_KEY, JSON.stringify(next));
    window.localStorage.removeItem(RECENT_PAPERS_LEGACY_KEY);
  } catch {
    // 写不进去就算了,这是纯增强功能
  }
}
