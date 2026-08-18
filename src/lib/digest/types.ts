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

/** 单个作者的引用量指标（Semantic Scholar；新人 hIndex/citations 可为 null，语义 ≠ 0） */
export interface AuthorMetric {
  name: string;
  hIndex: number | null;
  citations: number | null;
}

/** 一篇论文的作者信号（enrich-author-signal step 产出）。只存三个槽位控制 workflow step state 体积 */
export interface AuthorSignal {
  first: AuthorMetric | null;
  /** 单作者时与 first 相同（渲染层合并为一段） */
  last: AuthorMetric | null;
  /** 全作者列表中最高 h-index（精锐大组常在中间位）；全 null 时为 null */
  maxHIndex: number | null;
  totalAuthors: number;
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
  /** canonicalizeCandidate 判不出日期的 intel：待 workflow 日期解析 step 补日期重过闸（transient，不落库） */
  dateUnknown?: boolean;
  /** 来源标注：源 id 或角度 label，进 sourceMeta 与简报日志 */
  sourceLabel: string;
  /** HF daily papers 热度（有则加权），来自 hf_signals */
  hfUpvotes?: number;
  /** 初筛相关性分 0-100（scoreSourceItems 产出）；预算裁剪按此排序，砍最低分 */
  prescore?: number;
  /** 作者名单（arXiv Atom 自带；>6 人截断为前 5 位 + 末位）。角度搜索/intel 候选无此字段 */
  authors?: string[];
  /** 截断前的作者总数，渲染 "+N more" 用 */
  authorCount?: number;
  /** S2 富集的引用量指标；未收录/富集失败/intel 为 undefined（渲染层出免罚文案） */
  authorSignal?: AuthorSignal;
}

export interface CandidateReview {
  /** 新意判断，必须有 noveltyQuote 原文引用支撑 */
  novelty: string;
  noveltyQuote: string;
  relevance: number; // 0-100 相对 focusBrief
  recommendation: string; // 推荐点草稿
  score: number; // 0-100 综合
}

/** 参谋标注（#69/#72 校准实验定稿）：结构化风险检查结果，只供 synthesize 参考，无否决权 */
export interface RiskAnnotation {
  /** 引文与 novelty 断言不同主题（逐字存在性由代码另行核验，此处只判主题相关性） */
  quoteTopicalFail: boolean;
  marketingFail: boolean;
  focusFail: boolean;
  /** 仅当 novelty 明确对位某 prior pick 且对不上号；引用外部文献永不触发 */
  priorPickFail: boolean;
  note: string;
}

export interface ReviewedCandidate {
  item: CandidateItem;
  review: CandidateReview;
  /** noveltyQuote 是否逐字（规范化+滑窗）出自全文；无全文时 undefined=无法核验 */
  quoteVerified?: boolean;
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

/** 往期已推荐论文的一行记忆（查重清单用）：来自 digest_papers × papers */
export interface PastPick {
  issueNumber: number;
  title: string;
  /** recommendationNote 的 zh-cn（缺则按 DIGEST_LOCALES 顺序回退），可为空串 */
  note: string;
}
