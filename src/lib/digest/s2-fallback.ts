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
// `"linear attention" -transformer` / `"linear attention" - transformer` /
// `(linear attention) | (state space)` 等对
// https://api.semanticscholar.org/graph/v1/paper/search/bulk 实测；复核时
// （同日）追加实测发现空格版 `-` 其实不生效，见下）：
// - 端点固定是 GET .../paper/search/bulk（与 enrich.ts 用的 POST batch 端点不同）。
// - query 语法：空格分隔的多词默认按近似 AND 处理、`|` 是 OR、双引号包裹的短语做
//   精确匹配、圆括号可分组且支持嵌套，均未报错。
// - 否定语法实测反直觉：紧贴词的 `-term`（无空格）确实生效；但空格分隔的
//   `- term` 会让整条查询**恒返回 0 条**（HTTP 200，无报错的静默清空，不是
//   429/400）。arXiv `ANDNOT` 关键字前后天然带空格，映射成 `-` 后无法保证紧贴
//   下一个 token（尤其 token 是带字段前缀/括号组的多词短语时更难保证不留空
//   格）；与其冒着「静默返回 0 条吃掉整个源」的风险，设计上直接整段丢弃
//   ANDNOT 子句（单 token 或单层括号组），把负向过滤这道工序交给下游
//   scoreSourceItems 初筛——降级路径宁多勿漏。
// - `publicationDateOrYear=YYYY-MM-DD:`（冒号后留空即开右端区间）语法确认可用，
//   返回行的 publicationDate 落在窗口起点之后；S2 该字段只有日粒度，故
//   s2RowsToCandidates 里 windowStart 也按日粒度（当日 00:00 UTC）比较，避免
//   windowStart 带时分（cron 触发时刻）导致起点当日发表的论文被误砍且永久丢失。
// - `limit` 查询参数不生效：实测 `limit=3` 仍返回该 query 命中的全部结果（一页
//   最多 1000 条，即 `total` 与 `data.length` 一致直到 1000 封顶，翻页要靠
//   `token`，本模块不做翻页——一页 1000 条对方向扫源场景足够）。因此仍在 URL 里
//   带上 limit（对未来行为变化无害），但必须客户端在**过滤之后**再 slice 到目标
//   条数——先 slice 再过滤会在超量时截掉一批还没来得及判断相关性的行，且
//   bulk search 默认按 paperId 排序，与「新论文优先」的扫源诉求无关，故额外带
//   `sort=publicationDate:desc` 让服务端按发表时间新→旧排序（S2 Graph API bulk
//   search 文档记录的标准参数，本轮复核当日 key 持续 429 未能重新实测，按既有
//   文档行为接入）。
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
 * - `ANDNOT <token 或单层括号组>` 整段丢弃（原因见文件头实测注释：映射成 `-`
 *   后一旦不紧贴下一 token 就会让整条查询静默返回 0 条，风险不可控，不如整段
 *   丢弃负向条件，交给下游初筛过滤误召回）——必须在 cat:/字段前缀剥除之前做，
 *   否则 ANDNOT 后跟的 `ti:`/`abs:`/`cat:` 前缀会被提前剥掉导致匹配不到
 * - `cat:xxx` 整项剥除（分类语义 S2 全文搜索无法表达）
 * - `ti:` / `abs:` / `all:` 字段前缀剥除，保留其值（含引号短语）
 * - `OR` → `|`，`AND` → 空格（S2 空格分隔默认近似 AND）
 * - 括号原样保留
 * - 剥除 cat:/ANDNOT 子句后常遗留悬空算子/空括号（如 "cat:cs.AI AND (...)" 剥完
 *   变成 " AND (...)"，"(cat:a OR cat:b)" 剥完变成 "( OR )"），迭代清理到收敛
 * - 清理收敛后若结果不含任何字母数字（例如整条查询本就是一个被丢弃的 ANDNOT
 *   子句，如 "cat:cs.LG ANDNOT (ti:survey OR ti:review)"），归一化为空串，
 *   交给调用方（fetchS2Fallback）统一按「无可用正向文本」抛错处理
 */
export function arxivQueryToS2Query(query: string): string {
  let q = query;
  // 1. 整段丢弃 ANDNOT 子句：ANDNOT 后跟一个带可选字段前缀的带引号短语 /
  // 字段:值 token / 单层括号组 / 裸词，四选一，取最长匹配优先
  q = q.replace(
    /\bANDNOT\s+(?:\([^()]*\)|(?:[A-Za-z]+:)?"[^"]*"|[A-Za-z]+:\S+|\S+)/gi,
    "",
  );
  // 2. 剥掉 cat:xxx 项。值字符集排除 ")"：否则 "(cat:cs.LG)" 这类紧贴右括号
  // 的写法会被 \S+ 贪婪吞掉右括号本身，破坏后续的括号平衡清理
  q = q.replace(/\bcat:[^\s)]+/gi, "");
  // 3. 剥掉字段前缀，保留值
  q = q.replace(/\b(?:ti|abs|all):/gi, "");
  // 4. 布尔算子映射
  q = q.replace(/\bOR\b/g, "|");
  q = q.replace(/\bAND\b/g, " ");
  // 5. 迭代清理剥除操作遗留的悬空算子与空括号
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
  // 6. 收敛后无任何字母数字 = 无可用正向文本，归一化为空串
  if (!/[A-Za-z0-9]/.test(q)) return "";
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
 * - publicationDate 非 null 且早于 windowStart**所在自然日**（UTC）的行丢弃；
 *   S2 publicationDate 只有日粒度，若直接拿带时分的 windowStart（cron 触发
 *   时刻，如当日 12:00 UTC）去比较，会把窗口起点当天发表的论文全部误判为
 *   「早于窗口」丢弃，且这批论文不会在下周窗口里补回（已经不在下周窗口范围
 *   内），是永久丢失——故按日粒度对齐，与请求时用的 publicationDateOrYear
 *   口径一致。publicationDate 为 null（或畸形无法解析）的行保留且省略
 *   publishedAt——S2 兜底宁多勿漏，下游 scoreSourceItems 初筛与后续精读会
 *   再过滤一轮
 */
export function s2RowsToCandidates(
  rows: S2SearchRow[],
  sourceLabel: string,
  windowStart: Date,
): CandidateItem[] {
  const windowStartDay = new Date(
    `${windowStart.toISOString().slice(0, 10)}T00:00:00.000Z`,
  );
  const items: CandidateItem[] = [];
  for (const row of rows) {
    const arxivId = row.externalIds?.ArXiv;
    if (!arxivId) continue;
    let publishedAt: string | undefined;
    if (row.publicationDate) {
      const d = new Date(row.publicationDate);
      if (!Number.isNaN(d.getTime())) {
        if (d < windowStartDay) continue;
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
 * 非 2xx / 响应形状不对 / 映射后无可用正向文本（纯 cat: 过滤源、或整条查询
 * 是被丢弃的 ANDNOT 子句）都抛错，由调用方（digest-workflow.ts 的兜底 step）
 * 整体降级为丢弃该源。
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
      "s2 fallback: no searchable text after mapping (arxiv query has no positive text to fall back on)",
    );
  }
  const limit = config.maxResults ?? 50;
  const dateFrom = windowStart.toISOString().slice(0, 10);
  // sort=publicationDate:desc：bulk search 默认按 paperId 排序，与「新论文
  // 优先」的扫源诉求无关；超量时不带排序会从任意一段截取，带上后至少保证
  // 截断时优先保留窗口内较新的论文（S2 Graph API bulk search 文档记录的标准
  // 排序参数）
  const url =
    `${S2_SEARCH_BULK_API}?query=${encodeURIComponent(mapped)}` +
    `&fields=${encodeURIComponent("title,abstract,externalIds,publicationDate")}` +
    `&publicationDateOrYear=${dateFrom}:` +
    `&sort=publicationDate:desc` +
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
  // 先过滤（丢无 arXiv id / 早于窗口起点日的行）再 slice 到目标条数：反过来
  // 先 slice 会在响应超量时截掉一批还没判断相关性的行，让最终产出条数
  // 系统性偏少
  return s2RowsToCandidates(body.data, sourceLabel, windowStart).slice(
    0,
    limit,
  );
}
