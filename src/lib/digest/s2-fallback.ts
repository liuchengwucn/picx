// src/lib/digest/s2-fallback.ts
//
// arXiv 429 重试耗尽后的降级路径：改用 Semantic Scholar bulk search 端点按
// 文本相关性搜索兜底，产出经 scoreSourceItems 初筛复核后才并入候选池（见
// digest-workflow.ts 的 scan-source-*-s2-fallback step）。这是「尽力映射」不是
// 等价替换——S2 全文相关性排序 ≠ arXiv 字段查询语义，接受召回质量下降换本周不
// 丢源；S2 收录 arXiv 论文有几天延迟，最新 1-2 天的论文本周可能覆盖不到，欠的
// 会在下周常规 arXiv 扫描里从 seen 池自然补回，这是接受的取舍。
//
// 实测结论（2026-08-14，用 query=`linear attention` /
// `"linear attention" -transformer` / `(linear attention) | (state space)` 等
// 对 https://api.semanticscholar.org/graph/v1/paper/search/bulk 实测）：
// - 端点固定是 GET .../paper/search/bulk（与 enrich.ts 用的 POST batch 端点不同）。
// - query 语法：空格分隔的多词默认按近似 AND 处理、`|` 是 OR、前置 `-` 是 NOT
//   （`-term` 与 `- term` 两种写法都生效，无需刻意去掉中间空格）、双引号包裹的
//   短语做精确匹配、圆括号可分组且支持嵌套，均未报错。
// - `publicationDateOrYear=YYYY-MM-DD:`（冒号后留空即开右端区间）语法确认可用，
//   返回行的 publicationDate 落在窗口起点之后。
// - `limit` 查询参数不生效：实测 `limit=3` 仍返回该 query 命中的全部结果（一页
//   最多 1000 条，即 `total` 与 `data.length` 一致直到 1000 封顶，翻页要靠
//   `token`，本模块不做翻页——一页 1000 条对方向扫源场景足够）。因此仍在 URL 里
//   带上 limit（对未来行为变化无害），但必须客户端 slice 到目标条数兜底。
// - 无 key 时限流很严（1 rps 都会偶发 429），带 x-api-key 更宽松；两者都交给
//   调用方（digest-workflow.ts）的 LLM_RETRIES 20s 指数退避重试，不在本模块内重试。
import type { DirectionSourceConfig } from "#/db/schema";
import { canonicalArxivUrl } from "#/lib/arxiv";
import { MAX_EXCERPT } from "./sources";
import type { CandidateItem } from "./types";

const S2_SEARCH_BULK_API =
  "https://api.semanticscholar.org/graph/v1/paper/search/bulk";

/**
 * arXiv API 查询式 → S2 bulk search 纯文本查询的尽力映射（降级路径，非等价
 * 替换）。规则：
 * - `cat:xxx` 整项剥除（分类语义 S2 全文搜索无法表达）
 * - `ti:` / `abs:` / `all:` 字段前缀剥除，保留其值（含引号短语）
 * - `ANDNOT` → `-`，`OR` → `|`，`AND` → 空格（S2 空格分隔默认近似 AND）
 * - 括号原样保留
 * - 剥除 cat: 项后常遗留悬空算子/空括号（如 "cat:cs.AI AND (...)" 剥完
 *   变成 " AND (...)"，"(cat:a OR cat:b)" 剥完变成 "( OR )"），迭代清理到收敛
 */
export function arxivQueryToS2Query(query: string): string {
  let q = query;
  // 1. 剥掉 cat:xxx 项。值字符集排除 ")"：否则 "(cat:cs.LG)" 这类紧贴右括号
  // 的写法会被 \S+ 贪婪吞掉右括号本身，破坏后续的括号平衡清理
  q = q.replace(/\bcat:[^\s)]+/gi, "");
  // 2. 剥掉字段前缀，保留值
  q = q.replace(/\b(?:ti|abs|all):/gi, "");
  // 3. 布尔算子映射（ANDNOT 必须先于 AND 处理，否则会被 AND 规则截胡成 "-NOT"）
  q = q.replace(/\bANDNOT\b/g, "-");
  q = q.replace(/\bOR\b/g, "|");
  q = q.replace(/\bAND\b/g, " ");
  // 4. 迭代清理剥除操作遗留的悬空算子与空括号
  let prev: string;
  do {
    prev = q;
    q = q
      .replace(/\(\s*\)/g, "") // 空括号
      .replace(/\(\s*[|-]\s*/g, "(") // 括号内紧跟开头的悬空 | 或 -
      .replace(/\s*[|-]\s*\)/g, ")") // 括号内紧邻结尾的悬空 | 或 -
      .replace(/^\s*[|-]\s*/, "") // 串首悬空算子
      .replace(/\s*[|-]\s*$/, "") // 串尾悬空算子
      .replace(/\s{2,}/g, " ")
      .trim();
  } while (q !== prev);
  return q;
}

/** S2 bulk search 响应里单行的形状（只取本模块用到的字段） */
export interface S2SearchRow {
  title?: string | null;
  abstract?: string | null;
  publicationDate?: string | null;
  externalIds?: { ArXiv?: string | null } | null;
}

interface S2BulkSearchResponse {
  total?: number;
  token?: string | null;
  data?: S2SearchRow[];
}

/**
 * S2 bulk search 响应行 → CandidateItem 纯映射。
 * - 无 externalIds.ArXiv 的行丢弃（非 arXiv 论文，与 digest 论文导入契约不符）
 * - publicationDate 非 null 且早于 windowStart 的行丢弃；publicationDate 为
 *   null（或畸形无法解析）的行保留且省略 publishedAt——S2 兜底宁多勿漏，
 *   下游 scoreSourceItems 初筛与后续精读会再过滤一轮
 */
export function s2RowsToCandidates(
  rows: S2SearchRow[],
  sourceLabel: string,
  windowStart: Date,
): CandidateItem[] {
  const items: CandidateItem[] = [];
  for (const row of rows) {
    const arxivId = row.externalIds?.ArXiv;
    if (!arxivId) continue;
    let publishedAt: string | undefined;
    if (row.publicationDate) {
      const d = new Date(row.publicationDate);
      if (!Number.isNaN(d.getTime())) {
        if (d < windowStart) continue;
        publishedAt = d.toISOString();
      }
    }
    items.push({
      canonicalUrl: canonicalArxivUrl(arxivId),
      title: (row.title ?? "").trim(),
      kind: "paper",
      ...(row.abstract
        ? { excerpt: row.abstract.trim().slice(0, MAX_EXCERPT) }
        : {}),
      ...(publishedAt ? { publishedAt } : {}),
      sourceLabel,
    });
  }
  return items;
}

/**
 * arXiv 429 兜底：把 config.query 尽力映射为 S2 文本查询后调 bulk search。
 * 非 2xx / 响应形状不对 / 映射后查询为空（纯 cat: 过滤源无文本可搜）都抛错，
 * 由调用方（digest-workflow.ts 的兜底 step）整体降级为丢弃该源。
 */
export async function fetchS2Fallback(
  config: DirectionSourceConfig,
  windowStart: Date,
  sourceLabel: string,
  apiKey?: string,
): Promise<CandidateItem[]> {
  if (!config.query) {
    throw new Error("s2 fallback: source missing config.query");
  }
  const mapped = arxivQueryToS2Query(config.query);
  if (!mapped) {
    throw new Error(
      "s2 fallback: mapped query is empty (category-only arxiv query has no text to fall back on)",
    );
  }
  const limit = config.maxResults ?? 50;
  const dateFrom = windowStart.toISOString().slice(0, 10);
  const url =
    `${S2_SEARCH_BULK_API}?query=${encodeURIComponent(mapped)}` +
    `&fields=${encodeURIComponent("title,abstract,externalIds,publicationDate")}` +
    `&publicationDateOrYear=${dateFrom}:` +
    `&limit=${limit}`;
  const headers: Record<string, string> = {};
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`semantic scholar bulk search: ${res.status}`);
  }
  const body = (await res.json()) as S2BulkSearchResponse;
  if (!Array.isArray(body.data)) {
    throw new Error(
      "semantic scholar bulk search: unrecognized response (no data array)",
    );
  }
  return s2RowsToCandidates(
    body.data.slice(0, limit),
    sourceLabel,
    windowStart,
  );
}
