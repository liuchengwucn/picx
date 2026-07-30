import type { NewsMedia } from "#/db/schema";

/** 各来源适配器统一产出的规范化条目 */
export interface NormalizedItem {
  url: string;
  title: string;
  excerpt?: string;
  author?: string;
  publishedAt: Date;
  signals?: Record<string, number>;
  media?: NewsMedia[];
  extra?: Record<string, unknown>;
}
