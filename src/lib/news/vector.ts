export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** 增量均值：centroid 已代表 count 条向量，将新向量并入 */
export function mergeCentroid(
  centroid: Float32Array,
  count: number,
  next: Float32Array,
): Float32Array {
  if (centroid.length !== next.length) {
    throw new Error(
      `mergeCentroid: dimension mismatch ${centroid.length} vs ${next.length}`,
    );
  }
  const merged = new Float32Array(centroid.length);
  for (let i = 0; i < centroid.length; i++) {
    merged[i] = (centroid[i] * count + next[i]) / (count + 1);
  }
  return merged;
}

/**
 * 从全部成员向量重算均值。用于 summarize 阶段自愈 centroid：
 * mergeCentroid 是增量的，一旦发生重复并入（D1 无事务，story 更新成功但 item 更新失败，
 * 下轮又并入一次）偏差会永久留在 centroid 里，只有全量重算能纠回。
 */
export function meanVector(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) {
    throw new Error("meanVector: empty input");
  }
  const dim = vectors[0].length;
  const mean = new Float32Array(dim);
  for (const vector of vectors) {
    if (vector.length !== dim) {
      throw new Error(
        `meanVector: dimension mismatch ${vector.length} vs ${dim}`,
      );
    }
    for (let i = 0; i < dim; i++) {
      mean[i] += vector[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    mean[i] /= vectors.length;
  }
  return mean;
}
