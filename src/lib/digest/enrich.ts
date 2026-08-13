// src/lib/digest/enrich.ts
//
// Semantic Scholar 作者指标富集（每期每方向一次批量调用）。
// 定位是弱先验信号：任何失败（429/超时/未收录）都由调用方降级为
// 「无信号」（渲染层出免罚文案），绝不影响期刊产出。
import { canonicalArxivId } from "#/lib/arxiv";
import type { AuthorMetric, AuthorSignal } from "./types";

const S2_BATCH_API = "https://api.semanticscholar.org/graph/v1/paper/batch";
/** S2 batch 单次上限。正常预算 ≤40，触达上限说明上游预算约束坏了——截断并留痕，别打爆 API */
const S2_BATCH_LIMIT = 500;

/** S2 batch 响应里的单篇形状（未收录的位置整个是 null） */
export interface S2Paper {
  authors?: Array<{
    name?: string | null;
    hIndex?: number | null;
    citationCount?: number | null;
  }> | null;
}

/**
 * S2 响应 → url→AuthorSignal 纯映射。与输入 urls 按索引对齐；
 * null 条目（未收录）、空 authors、越界（响应比输入短）都跳过——
 * 缺席即无信号，渲染层负责免罚文案。
 */
export function buildAuthorSignals(
  urls: string[],
  rows: Array<S2Paper | null>,
): Record<string, AuthorSignal> {
  const out: Record<string, AuthorSignal> = {};
  urls.forEach((url, i) => {
    const authors = rows[i]?.authors ?? [];
    if (authors.length === 0) return;
    const metrics = authors.map(
      (a): AuthorMetric => ({
        name: (a.name ?? "").trim(),
        hIndex: typeof a.hIndex === "number" ? a.hIndex : null,
        citations: typeof a.citationCount === "number" ? a.citationCount : null,
      }),
    );
    const hs = metrics
      .map((m) => m.hIndex)
      .filter((h): h is number => h !== null);
    out[url] = {
      first: metrics[0] ?? null,
      last: metrics[metrics.length - 1] ?? null,
      maxHIndex: hs.length > 0 ? Math.max(...hs) : null,
      totalAuthors: metrics.length,
    };
  });
  return out;
}

/**
 * 批量查询 S2。canonicalUrl 解析不出 arXiv id 的候选直接跳过；
 * 全部不可查时零请求返回 {}。非 2xx / 超时抛错，由调用方
 * （workflow step 外层 catch）整体降级。
 */
export async function enrichAuthorSignals(
  candidateUrls: string[],
  apiKey?: string,
): Promise<Record<string, AuthorSignal>> {
  let targets = candidateUrls
    .map((url) => ({ url, id: canonicalArxivId(url) }))
    .filter((t): t is { url: string; id: string } => t.id !== null);
  if (targets.length === 0) return {};
  if (targets.length > S2_BATCH_LIMIT) {
    console.warn(
      `[Digest] enrich: ${targets.length} ids exceed S2 batch limit, truncating to ${S2_BATCH_LIMIT}`,
    );
    targets = targets.slice(0, S2_BATCH_LIMIT);
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(
    `${S2_BATCH_API}?fields=${encodeURIComponent("authors.name,authors.hIndex,authors.citationCount")}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ ids: targets.map((t) => `ARXIV:${t.id}`) }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) throw new Error(`semantic scholar batch: ${res.status}`);
  const rows = (await res.json()) as Array<S2Paper | null>;
  return buildAuthorSignals(
    targets.map((t) => t.url),
    rows,
  );
}
