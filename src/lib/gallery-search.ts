/** 画廊筛选/搜索参数的纯解析与规范化工具,前后端共用。 */

export type GallerySort = "recent" | "popular";

/**
 * /gallery 无限滚动列表的 react-query key 前缀。它是手写的 useInfiniteQuery
 * (不走 trpc queryOptions), 所以 trpc.paper.listPublic.pathKey() 抓不到它——
 * 投完票要刷新卡片上的赞数, 得点名这个前缀失效。
 */
export const GALLERY_LIST_QUERY_KEY = "gallery-list";

/**
 * 转义用户搜索词里的 SQLite LIKE 通配符(% _ 和转义符 \),
 * 配合查询里的 `ESCAPE '\'` 使用,防止用户输入被当通配符。
 * 注意:反斜杠要先转义,避免二次转义。
 */
export function escapeLike(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** 解析逗号分隔的 query 参数为去空白、去空值的数组。 */
export function parseCsvParam(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 把任意输入收敛到合法排序,默认 recent。 */
export function parseSort(raw: string | undefined): GallerySort {
  return raw === "popular" ? "popular" : "recent";
}
