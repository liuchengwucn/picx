// src/lib/feed/types.ts
//
// feed 的中性数据模型：D1 查询产出它，三个渲染器消费它。渲染器不碰 D1、
// 不碰业务概念，加第四种输出格式就是加一个 render-*.ts。

/** DB 里四语 JSON 字段（news_stories.title、digests.content 等）的键 */
export type LocaleKey = "en" | "zh-cn" | "zh-tw" | "ja";

/**
 * 三套语言写法的**唯一**映射表。别处一律不准手写语言字符串。
 *  - key:       DB JSON key，同时是 URL 里的 locale 段（小写）
 *  - bcp47:     输出到 xml:lang / <language> / JSON Feed language
 *  - paraglide: 传给 m.xxx({}, { locale }) 的值（大写区域段）
 */
export const FEED_LOCALES = [
  { key: "en", bcp47: "en", paraglide: "en" },
  { key: "zh-cn", bcp47: "zh-CN", paraglide: "zh-CN" },
  { key: "zh-tw", bcp47: "zh-TW", paraglide: "zh-TW" },
  { key: "ja", bcp47: "ja", paraglide: "ja" },
] as const satisfies ReadonlyArray<{
  key: LocaleKey;
  bcp47: string;
  paraglide: "en" | "zh-CN" | "zh-TW" | "ja";
}>;

export type FeedLocale = (typeof FEED_LOCALES)[number];

/** URL 里的 locale 段 → 映射表项；非法返回 null（调用方一律 404，不查库） */
export function findFeedLocale(key: string): FeedLocale | null {
  return FEED_LOCALES.find((l) => l.key === key) ?? null;
}

/** 缺 locale 的地址重定向到的默认语言 */
export const DEFAULT_FEED_LOCALE: FeedLocale = FEED_LOCALES[0];

// 条数上限。资讯每小时聚合，50 条约覆盖 1-2 天；周报周更，30 期约一个月。
export const NEWS_FEED_LIMIT = 50;
export const DIGEST_FEED_LIMIT = 30;
export const DIGEST_DIRECTION_FEED_LIMIT = 20;

/**
 * tag URI（RFC 4151）的权威部分。日期是「域名归属日」不是内容日期，写死。
 *
 * 警告：这个值与 buildFeedItemId/buildFeedChannelId 的格式**发布后永不可变**。
 * 改了等于把全站条目变成新条目，所有订阅者会收到一遍重复推送，且收不回。
 */
export const TAG_URI_AUTHORITY = "picx.dev,2026";

export function buildFeedItemId(path: string, locale: LocaleKey): string {
  return `tag:${TAG_URI_AUTHORITY}:${path}/${locale}`;
}

export function buildFeedChannelId(path: string, locale: LocaleKey): string {
  return `tag:${TAG_URI_AUTHORITY}:feed/${path}/${locale}`;
}

export interface FeedItem {
  /** tag URI；含 locale，跨语言唯一（同时订阅两种语言的用户不会被聚合器去重掉一份） */
  id: string;
  title: string;
  url: string;
  published: Date;
  updated: Date;
  /** 已组装好的 HTML 片段（组装侧已转义一次，渲染器还会按格式再转一次，见 render-atom 注释） */
  contentHtml: string;
  /** 纯文本一句话；Atom <summary>、JSON Feed summary */
  summaryText?: string;
  categories?: Array<{ term: string; label: string }>;
  /** 封面图；Atom link rel="enclosure" / RSS <enclosure> / JSON Feed image */
  image?: { url: string; mime?: string };
}

export interface FeedChannel {
  id: string;
  title: string;
  subtitle: string;
  /** 本 feed 自身的 canonical（.xml）地址 */
  selfUrl: string;
  /** 对应的站内 HTML 页面 */
  htmlUrl: string;
  localeKey: LocaleKey;
  bcp47: string;
  alternates: Array<{ hreflang: string; href: string }>;
  updated: Date;
  items: FeedItem[];
}
