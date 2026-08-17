// src/lib/digest/candidates.ts
import { canonicalArxivId } from "#/lib/arxiv";
import type { CandidateItem, ReviewedCandidate } from "./types";

/**
 * 本期精读预算：论文与 intel 分开计。稳态下每周新增候选远小于首跑积压，
 * 预算的角色是病态周的保险丝而非常态过滤。intel 精读通过率极高（近似
 * 直通 synthesize prompt），上限须明显低于论文侧，防合成提示词膨胀。
 */
export const PAPER_REVIEW_BUDGET = 100;
export const INTEL_REVIEW_BUDGET = 50;
/** 已 rejected 的候选，HF 热度达到该值时允许重新浮出（迟到爆款） */
export const LATE_BLOOMER_UPVOTES = 30;

/** 候选池行的最小形状（store 层从 direction_candidates 读出后传入） */
export interface PoolEntry {
  canonicalUrl: string;
  status: "seen" | "recommended" | "rejected";
  score: number | null;
}

/**
 * 跨来源合并去重：同 canonicalUrl 首见者保留，后见者只合并 sourceLabel；
 * 并用 hf_signals（arxivId → upvotes）标注热度。
 */
export function mergeCandidates(
  groups: CandidateItem[][],
  hfUpvotesByArxivId: Map<string, number>,
): CandidateItem[] {
  const byUrl = new Map<string, CandidateItem>();
  for (const group of groups) {
    for (const item of group) {
      const key = item.canonicalUrl;
      const existing = byUrl.get(key);
      if (existing) {
        if (!existing.sourceLabel.split(",").includes(item.sourceLabel)) {
          existing.sourceLabel = `${existing.sourceLabel},${item.sourceLabel}`;
        }
        if ((item.prescore ?? -1) > (existing.prescore ?? -1)) {
          existing.prescore = item.prescore;
        }
        continue;
      }
      const arxivId = canonicalArxivId(item.canonicalUrl);
      const hfUpvotes = arxivId ? hfUpvotesByArxivId.get(arxivId) : undefined;
      byUrl.set(key, { ...item, hfUpvotes });
    }
  }
  return [...byUrl.values()];
}

export interface PartitionResult {
  toReview: CandidateItem[];
  /** 与池比对被跳过（已推荐 / 已拒且无新信号） */
  skipped: CandidateItem[];
  /** 预算外，记 seen 留待下期；名单进简报生成日志（no silent caps） */
  overBudget: CandidateItem[];
}

/** 对齐历史候选池 + 应用精读预算。热度高者优先占预算。 */
export function partitionCandidates(
  merged: CandidateItem[],
  pool: PoolEntry[],
): PartitionResult {
  const poolByUrl = new Map(pool.map((p) => [p.canonicalUrl, p]));
  const eligible: CandidateItem[] = [];
  const skipped: CandidateItem[] = [];
  for (const item of merged) {
    const entry = poolByUrl.get(item.canonicalUrl);
    if (!entry) {
      eligible.push(item);
      continue;
    }
    if (entry.status === "recommended") {
      skipped.push(item);
      continue;
    }
    if (entry.status === "rejected") {
      // 迟到爆款：拒过但 HF 热度显著，允许重评
      if ((item.hfUpvotes ?? 0) >= LATE_BLOOMER_UPVOTES) eligible.push(item);
      else skipped.push(item);
      continue;
    }
    // status === "seen"（上期预算外或未评审）：本期重新参评
    eligible.push(item);
  }
  // 预算裁剪砍尾：热度优先、初筛分次之、新发布再次——被砍的永远是最不可惜的
  eligible.sort(
    (a, b) =>
      (b.hfUpvotes ?? 0) - (a.hfUpvotes ?? 0) ||
      (b.prescore ?? 0) - (a.prescore ?? 0) ||
      (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
  );
  const papers = eligible.filter((i) => i.kind === "paper");
  const intel = eligible.filter((i) => i.kind === "intel");
  return {
    toReview: [
      ...papers.slice(0, PAPER_REVIEW_BUDGET),
      ...intel.slice(0, INTEL_REVIEW_BUDGET),
    ],
    skipped,
    overBudget: [
      ...papers.slice(PAPER_REVIEW_BUDGET),
      ...intel.slice(INTEL_REVIEW_BUDGET),
    ],
  };
}

/** 精读后进入 synthesize 的供给集大小（含并列会放宽到 ~10-15） */
export const TOP_K_PAPERS = 10;

/**
 * 含并列 top-K：取「score ≥ 第 k 名 score」的全部论文。
 * 必须含并列——实测 review 分大量并列（8 篇挤 88 分），硬 K 切线的 tie-break
 * 是随机序，会让入选集在重跑间抖动（#72 E6：Jaccard 仅 0.72）。
 */
export function selectTopPapers(
  papers: ReviewedCandidate[],
  k: number,
): ReviewedCandidate[] {
  if (papers.length <= k) return [...papers];
  const sorted = [...papers].sort((a, b) => b.review.score - a.review.score);
  const threshold = sorted[k - 1].review.score;
  return sorted.filter((p) => p.review.score >= threshold);
}

const normalizeForMatch = (s: string) =>
  s
    .toLowerCase()
    // 直引号用于缩写（don't），保留；弯双引号是包裹引用的装饰符，随其余
    // 标点一起在下一步被剥离——否则残留的引号字符会让「原文无引号」的
    // 逐字引用永远不命中。
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * noveltyQuote 是否「逐字」出自全文。规范化后先整段 substring；未中则 8 词滑窗
 * （步长 4）命中率 ≥70% 判 true——review 合法引文常含省略号拼接或公式转码差异
 * （#72 实测 74 份：51 精确 + 19 滑窗命中 + 4 公式 miss，零捏造）。
 */
export function quoteAppearsInText(quote: string, text: string): boolean {
  const q = normalizeForMatch(quote);
  if (!q) return false;
  const t = normalizeForMatch(text);
  if (t.includes(q)) return true;
  const words = q.split(" ");
  if (words.length < 8) return false;
  let hit = 0;
  let total = 0;
  for (let i = 0; i + 8 <= words.length; i += 4) {
    total++;
    if (t.includes(words.slice(i, i + 8).join(" "))) hit++;
  }
  return total > 0 && hit / total >= 0.7;
}
