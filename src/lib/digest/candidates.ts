// src/lib/digest/candidates.ts
import { canonicalArxivId } from "#/lib/arxiv";
import type { CandidateItem, VerifyVerdict } from "./types";

/** 本期精读预算：论文与 intel 分开计（intel 便宜但也要有上限） */
export const PAPER_REVIEW_BUDGET = 20;
export const INTEL_REVIEW_BUDGET = 15;
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
        if (!existing.sourceLabel.includes(item.sourceLabel)) {
          existing.sourceLabel = `${existing.sourceLabel},${item.sourceLabel}`;
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
  // 热度优先、新发布优先
  eligible.sort(
    (a, b) =>
      (b.hfUpvotes ?? 0) - (a.hfUpvotes ?? 0) ||
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

export type VoteOutcome = "pass" | "rejected" | "unverified";

/**
 * 对抗投票计票。infra 失败（null 票）与被否决严格分开：
 * 有效票不足 2 → unverified（候选保持 seen 下期重评）；
 * 反驳票 ≥ 2 → rejected；否则 pass。
 */
export function tallyVotes(votes: Array<VerifyVerdict | null>): VoteOutcome {
  const valid = votes.filter((v): v is VerifyVerdict => v !== null);
  const refuted = valid.filter((v) => v.refuted).length;
  if (refuted >= 2) return "rejected";
  if (valid.length < 2) return "unverified";
  return "pass";
}
