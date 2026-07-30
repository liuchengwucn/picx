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
  const merged = new Float32Array(centroid.length);
  for (let i = 0; i < centroid.length; i++) {
    merged[i] = (centroid[i] * count + next[i]) / (count + 1);
  }
  return merged;
}
