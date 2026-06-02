/**
 * 公开画廊固定主分类的唯一数据源。
 * slug 稳定不变(用于 URL / SEO / DB 存储);界面显示名走 Paraglide。
 * 清单参照 AAAI-26 主技术赛道与 NeurIPS-25 投稿主题校准,
 * 向 HuggingFace 每日论文的实际分布倾斜。
 */
export const PAPER_CATEGORY_SLUGS = [
  "llm",
  "nlp",
  "multimodal",
  "vision",
  "generative",
  "speech-audio",
  "reinforcement-learning",
  "agents",
  "reasoning-planning",
  "retrieval-rag",
  "robotics-3d",
  "ml-theory",
  "efficiency",
  "data-benchmark",
  "alignment-safety",
  "ai-for-science",
  "other",
] as const;

export type PaperCategorySlug = (typeof PAPER_CATEGORY_SLUGS)[number];

const SLUG_SET = new Set<string>(PAPER_CATEGORY_SLUGS);

export function isValidCategorySlug(slug: string): slug is PaperCategorySlug {
  return SLUG_SET.has(slug);
}

/** 过滤出合法 slug 并去重(顺序保持首次出现)。 */
export function normalizeCategorySlugs(slugs: string[]): PaperCategorySlug[] {
  const seen = new Set<string>();
  const out: PaperCategorySlug[] = [];
  for (const s of slugs) {
    if (isValidCategorySlug(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}
