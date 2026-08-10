// src/lib/digest/types.ts
/** 简报覆盖的 locale，与全站一致 */
export const DIGEST_LOCALES = ["zh-cn", "zh-tw", "en", "ja"] as const;
export type DigestLocale = (typeof DIGEST_LOCALES)[number];
/** 定稿的主语言，其余三语由翻译步产出 */
export const PRIMARY_LOCALE: DigestLocale = "zh-cn";

export interface ScopeAngle {
  label: string;
  query: string;
  rationale?: string;
}

export interface ScopeResult {
  angles: ScopeAngle[];
}

/** 一条待评审候选（论文或非论文情报），跨 源适配器/角度搜索 的统一形状 */
export interface CandidateItem {
  /** 论文用 canonicalArxivUrl 规范化；intel 用讨论串/文章链接 */
  canonicalUrl: string;
  title: string;
  kind: "paper" | "intel";
  /** 摘要/首帖内容等，喂给初筛与精读 */
  excerpt?: string;
  publishedAt?: string; // ISO
  /** 来源标注：源 id 或角度 label，进 sourceMeta 与简报日志 */
  sourceLabel: string;
  /** HF daily papers 热度（有则加权），来自 hf_signals */
  hfUpvotes?: number;
  /** 初筛相关性分 0-100（scoreSourceItems 产出）；预算裁剪按此排序，砍最低分 */
  prescore?: number;
}

export interface CandidateReview {
  /** 新意判断，必须有 noveltyQuote 原文引用支撑 */
  novelty: string;
  noveltyQuote: string;
  relevance: number; // 0-100 相对 focusBrief
  recommendation: string; // 推荐点草稿
  score: number; // 0-100 综合
}

export interface VerifyVerdict {
  refuted: boolean;
  evidence: string;
}

export interface ReviewedCandidate {
  item: CandidateItem;
  review: CandidateReview;
}

export interface SynthesisPick {
  canonicalUrl: string;
  rank: number;
  recommendationNote: string; // 主语言
}

export interface SynthesisResult {
  title: string; // 主语言
  content: string; // 主语言 markdown 正文
  picks: SynthesisPick[];
  /** 正文实际引用的 intel canonicalUrl 列表；用于跨期去重（标 recommended） */
  usedIntelUrls?: string[];
  proposedFocusUpdate?: string;
}

/** 反馈样本（taste few-shot） */
export interface FeedbackSample {
  paperTitle: string;
  vote: number;
  reasonPreset?: string | null;
  reasonText?: string | null;
}
