// src/routes/rss.$.tsx
import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { drizzle } from "drizzle-orm/d1";
import { buildDigestFeed } from "#/lib/feed/digest-feed";
import { buildNewsFeed } from "#/lib/feed/news-feed";
import { renderAtom } from "#/lib/feed/render-atom";
import { renderJsonFeed } from "#/lib/feed/render-json";
import { renderRss } from "#/lib/feed/render-rss";
import { type FeedExt, type FeedTarget, parseFeedPath } from "#/lib/feed/route";
import type { FeedChannel } from "#/lib/feed/types";
import { SITE_URL } from "#/lib/site-url";

interface AppEnvBindings {
  DB: D1Database;
}

const CONTENT_TYPES: Record<FeedExt, string> = {
  xml: "application/atom+xml; charset=utf-8",
  rss: "application/rss+xml; charset=utf-8",
  json: "application/feed+json; charset=utf-8",
};

const RENDERERS: Record<FeedExt, (channel: FeedChannel) => string> = {
  xml: renderAtom,
  rss: renderRss,
  json: renderJsonFeed,
};

// 资讯每小时聚合，周报周更 —— 缓存窗口按各自节奏给
const NEWS_CACHE_CONTROL = "public, max-age=1800, s-maxage=1800";
const DIGEST_CACHE_CONTROL = "public, max-age=3600, s-maxage=21600";

function textResponse(body: string, status: number, extra?: HeadersInit) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...extra },
  });
}

/**
 * builder 产出的 selfUrl / alternates 一律是 canonical 的 .xml 地址（站内只宣传
 * Atom）。但 `rel="self"` 与 JSON Feed 的 `feed_url` 的语义是「你正在读的这份文档
 * 的地址」—— 服务 .rss / .json 时还指回 .xml，聚合器会照着去抓另一份文档。
 * alternates 同理：订阅 .rss 的人换语言也该拿到 .rss，而不是被换成 Atom。
 *
 * 只在呈现层改写：builder 不必知道自己被渲染成哪种格式。
 */
function withSelfExt(channel: FeedChannel, ext: FeedExt): FeedChannel {
  if (ext === "xml") return channel;
  const swap = (href: string) => href.replace(/\.xml$/, `.${ext}`);
  return {
    ...channel,
    selfUrl: swap(channel.selfUrl),
    alternates: channel.alternates.map((a) => ({ ...a, href: swap(a.href) })),
  };
}

function cacheKeyOf(target: FeedTarget): string {
  if (target.kind === "news") return "news";
  if (target.kind === "digest-all") return "digest";
  return `digest-${target.slug}`;
}

async function handler({ request }: { request: Request }) {
  const url = new URL(request.url);
  const parsed = parseFeedPath(url.pathname);

  if (parsed.type === "not-found") return textResponse("Not found", 404);
  if (parsed.type === "redirect") {
    return new Response(null, {
      status: 301,
      headers: { Location: parsed.location },
    });
  }

  const { target, locale, ext } = parsed.request;
  const db = drizzle((env as typeof env & AppEnvBindings).DB);

  let channel: FeedChannel | null;
  try {
    channel =
      target.kind === "news"
        ? await buildNewsFeed(db, locale, SITE_URL)
        : await buildDigestFeed(
            db,
            locale,
            SITE_URL,
            target.kind === "digest-direction" ? target.slug : null,
          );
  } catch (error) {
    // 与 sitemap / llms.txt 的静默降级刻意相反：那边少几个 URL 无所谓，这边
    // 返回「条目为空的合法 feed」有破坏性语义 —— 部分阅读器会理解成内容已撤下
    // 并清理本地条目，聚合器可能据此标记 feed 已死。5xx 只会触发正常重试。
    console.error(`[rss] build failed for ${url.pathname}:`, error);
    return textResponse("Feed temporarily unavailable", 503, {
      "Retry-After": "300",
    });
  }

  // 方向不存在 / 已下线：404。方向存在但还没出期 → channel.items 为空，那是
  // 正确状态，照常返回合法 feed。判据是「查询是否抛错 / 目标是否存在」，
  // 不是「结果是否为空」。
  if (!channel) return textResponse("Not found", 404);

  // itemCount 必须进 ETag：只用 max(updated) 的话，「删掉一条旧 story」不会改变
  // 最新时间，ETag 就骗人了。
  const etag = `W/"${cacheKeyOf(target)}-${locale.key}-${ext}-${channel.updated.getTime()}-${channel.items.length}"`;
  const headers: HeadersInit = {
    "Content-Type": CONTENT_TYPES[ext],
    "Cache-Control":
      target.kind === "news" ? NEWS_CACHE_CONTROL : DIGEST_CACHE_CONTROL,
    ETag: etag,
  };

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  // HEAD 只取头：聚合器会拿它探 ETag 决定要不要真下载，渲染整份 feed 再丢掉
  // 纯属浪费。故意不补 Content-Length —— 那要求先渲染出来量长度，正好抵消了
  // 走 HEAD 的意义，而聚合器认的是 ETag。
  if (request.method === "HEAD") {
    return new Response(null, { headers });
  }

  return new Response(RENDERERS[ext](withSelfExt(channel, ext)), { headers });
}

export const Route = createFileRoute("/rss/$")({
  server: {
    handlers: {
      GET: handler,
      // 不声明 HEAD 的话请求根本不进这个 handler，会掉回应用外壳拿到一份
      // 200 text/html —— 连 /rss/news.xml 的 301 都不生效。本仓库既有的
      // sitemap / llms.txt 也只声明了 GET，但那两个的消费方是搜索引擎爬虫
      // （走 GET）；feed 的消费方是聚合器，HEAD 探测是常规操作。
      HEAD: handler,
    },
  },
});
