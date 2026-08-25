// src/lib/feed/route.ts
import { DEFAULT_FEED_LOCALE, type FeedLocale, findFeedLocale } from "./types";

export type FeedTarget =
  | { kind: "news" }
  | { kind: "digest-all" }
  | { kind: "digest-direction"; slug: string };

export type FeedExt = "xml" | "rss" | "json";

export interface FeedRequest {
  target: FeedTarget;
  locale: FeedLocale;
  ext: FeedExt;
}

export type FeedRouteResult =
  | { type: "feed"; request: FeedRequest }
  | { type: "redirect"; location: string }
  | { type: "not-found" };

const EXTS = new Set<string>(["xml", "rss", "json"]);

// 方向 slug 的字符集。收紧到这一套是为了让「非法 slug 直接 404、不查库」成立。
const SLUG_RE = /^[a-z0-9-]+$/;

function parseTarget(base: string): FeedTarget | null {
  if (base === "news") return { kind: "news" };
  if (base === "digest") return { kind: "digest-all" };
  const m = base.match(/^digest\/(.+)$/);
  if (m && SLUG_RE.test(m[1])) return { kind: "digest-direction", slug: m[1] };
  return null;
}

/**
 * 解析 /rss/ 下的完整 pathname。
 *
 *   /rss/news.zh-cn.xml          → feed
 *   /rss/digest.ja.rss           → feed
 *   /rss/digest/llm.en.json      → feed
 *   /rss/news.xml                → 301 /rss/news.en.xml（扩展名保持不变）
 *   /rss/news.fr.xml             → 404（locale 非法）
 *   /rss/whatever.xml            → 404
 *
 * 缺 locale 一律 301 到 en 而不是内容协商：云端聚合器代表所有订阅者只抓一次，
 * 协商在这里语义上就不成立。
 */
export function parseFeedPath(pathname: string): FeedRouteResult {
  if (!pathname.startsWith("/rss/")) return { type: "not-found" };
  const rest = pathname.slice("/rss/".length);

  const lastDot = rest.lastIndexOf(".");
  if (lastDot === -1) return { type: "not-found" };
  const ext = rest.slice(lastDot + 1);
  if (!EXTS.has(ext)) return { type: "not-found" };

  let base = rest.slice(0, lastDot);
  let locale: FeedLocale | null = null;

  const localeDot = base.lastIndexOf(".");
  if (localeDot !== -1) {
    const maybe = findFeedLocale(base.slice(localeDot + 1));
    // 有第二个点却不是合法 locale：这不是「缺 locale」，是写错了 —— 404 而不是
    // 重定向，否则 /rss/news.fr.xml 会 301 到 /rss/news.fr.en.xml 这种垃圾地址。
    if (!maybe) return { type: "not-found" };
    locale = maybe;
    base = base.slice(0, localeDot);
  }

  const target = parseTarget(base);
  if (!target) return { type: "not-found" };

  if (!locale) {
    return {
      type: "redirect",
      location: `/rss/${base}.${DEFAULT_FEED_LOCALE.key}.${ext}`,
    };
  }
  return { type: "feed", request: { target, locale, ext: ext as FeedExt } };
}
