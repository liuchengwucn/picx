import type { NewsMedia } from "#/db/schema";

/** 各来源适配器统一产出的规范化条目 */
export interface NormalizedItem {
  url: string;
  title: string;
  excerpt?: string;
  author?: string;
  publishedAt: Date;
  /** 日期缺失/解析失败时的兜底标记（publishedAt 退到 now）：digest 扫源用它 fail-closed 丢弃，news 摄入暂维持 fail-open */
  publishedAtInferred?: boolean;
  signals?: Record<string, number>;
  media?: NewsMedia[];
  extra?: Record<string, unknown>;
}
