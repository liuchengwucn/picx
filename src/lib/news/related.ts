import { cosineSimilarity } from "#/lib/news/vector";

// 初始阈值 0.55，上线后按 debug 观察调整
export const RELATED_MIN_SIM = 0.55;
export const RELATED_MAX = 4;

export interface RelatedCandidate {
  id: string;
  shortId: string;
  centroid: Float32Array;
}

// 相似度达标的 top-K 相关故事（排除自身），返回 shortId 降序列表
export function pickRelated(
  selfId: string,
  centroid: Float32Array,
  candidates: RelatedCandidate[],
): string[] {
  return candidates
    .filter((c) => c.id !== selfId)
    .map((c) => ({
      shortId: c.shortId,
      sim: cosineSimilarity(centroid, c.centroid),
    }))
    .filter((c) => c.sim >= RELATED_MIN_SIM)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, RELATED_MAX)
    .map((c) => c.shortId);
}

// 反向补写合并：newcomer 插到头部、去重、截断。幂等——重复执行结果相同（D1 无事务的前提）
export function mergeRelated(
  existing: string[] | null | undefined,
  newcomer: string,
): string[] {
  return [newcomer, ...(existing ?? []).filter((s) => s !== newcomer)].slice(
    0,
    RELATED_MAX,
  );
}
