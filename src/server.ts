import handler from "@tanstack/react-start/server-entry";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { papers } from "#/db/schema";

// DO class 必须从 worker 入口导出，wrangler 才能按 class_name 找到它
export { ChatRunner } from "#/lib/chat-runner-do";

import { prefersMarkdown } from "#/lib/content-negotiation";
import {
  resolveDigestRef,
  retranslateDigestLocale,
} from "#/lib/digest/retranslate";
import {
  decideRequestLocale,
  isHtmlResponse,
  withLocaleCookies,
} from "#/lib/locale-cookie-policy";
import { goneIfHiddenStory } from "#/lib/news/gone";
import { loadPaperMarkdown } from "#/lib/paper-markdown";
import { defineCustomServerStrategy } from "#/paraglide/runtime";
import { paraglideMiddleware } from "#/paraglide/server.js";
import type { Env } from "#/types/env";
import arxivCron from "#/workers/arxiv-cron";
import digestCron from "#/workers/digest-cron";
import newsCron from "#/workers/news-cron";
import queueConsumer from "#/workers/queue-consumer";
import tweetPosterCron from "#/workers/tweet-poster-cron";

export { DigestWorkflow } from "#/workflows/digest-workflow";

// SSR locale 的 Accept-Language 兜底协商（cookie 没命中时走到这里）。客户端的
// 成对实现在 src/lib/locale-client-strategy.ts，两边共用 locale-negotiation.ts。
// 不能用 paraglide 内置的 preferredLanguage 策略：它的服务端实现会把语言标签
// toLowerCase 后原样返回（如 "zh-cn"），而 message 分发是 locale === "zh-CN"
// 精确比较、else 兜底是 ja → 中文用户会被渲染成日文。
// 注意：extractLocaleFromRequestAsync 会把 custom 策略排在所有内置策略之前执行
// （无视 strategy 数组里的顺序），所以判定必须自己先看 cookie——尊重现有 cookie
// 时返回 undefined 让位，内置 cookie 策略才能按预期优先生效。判定本身（含存量
// en cookie 的一次性重置）在 locale-cookie-policy.ts，与响应侧 Set-Cookie 共用。
defineCustomServerStrategy("custom-negotiate", {
  getLocale: (request?: Request) =>
    decideRequestLocale(
      request?.headers.get("cookie"),
      request?.headers.get("accept-language"),
    ).locale,
});

const MARKDOWN_HEADERS = {
  "Content-Type": "text/markdown; charset=utf-8",
  "Cache-Control": "public, max-age=3600, s-maxage=86400",
} as const;

/**
 * 把公开论文页以 Markdown 形式返回, 给 AI 检索爬虫低噪音内容。两种入口:
 *  - `/p/{shortId}.md`            —— 显式扩展 (TanStack 路由层表达不了, 在此拦截)
 *  - `/p/{shortId}` + Accept: text/markdown —— 内容协商 (非 UA 嗅探, 不是 cloaking)
 * 命中扩展名却查无此文 → 404; 内容协商查无此文 → 返回 null 交给正常 HTML 渲染。
 */
async function tryServePaperMarkdown(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");

  const explicit = url.pathname.match(/^\/p\/([^/]+?)\.md$/);
  if (explicit) {
    const db = drizzle(env.DB);
    const md = await loadPaperMarkdown(db, explicit[1], lang);
    if (md === null) {
      return new Response("Not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return new Response(md, { headers: MARKDOWN_HEADERS });
  }

  const negotiated = url.pathname.match(/^\/p\/([^/]+)$/);
  if (negotiated && prefersMarkdown(request.headers.get("accept"))) {
    const db = drizzle(env.DB);
    const md = await loadPaperMarkdown(db, negotiated[1], lang);
    if (md !== null) {
      return new Response(md, { headers: MARKDOWN_HEADERS });
    }
  }

  return null;
}

const ARXIV_CRON = "0 0 * * *";
// 北京时间 22:00 / 22:30 / 23:00（UTC 14:00 / 14:30 / 15:00）三次触发，
// 每次发当天剩余 upvotes 最高的 1 篇 → 依次发出 top-1 / top-2 / top-3。
const POSTER_CRONS = new Set(["0 14 * * *", "30 14 * * *", "0 15 * * *"]);
// 每小时整点: news-cron 新闻聚合流水线（与 ARXIV_CRON 在 00:00 各自独立触发）
const NEWS_CRON = "0 * * * *";
// 东京周六 21:00: digest-cron 方向周报挖掘。
// 必须与 wrangler.jsonc 的 cron 字符串逐字一致（controller.cron 按原文匹配）；
// CF cron 星期字段是 1=周日..7=周六，数字 6 是周五，所以统一用 SAT 缩写。
const DIGEST_CRON = "0 12 * * SAT";

async function dispatchScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  if (POSTER_CRONS.has(controller.cron)) {
    return tweetPosterCron.scheduled(controller, env, ctx);
  }
  if (controller.cron === NEWS_CRON) {
    return newsCron.scheduled(controller, env, ctx);
  }
  if (controller.cron === DIGEST_CRON) {
    return digestCron.scheduled(controller, env, ctx);
  }
  // ARXIV_CRON 及兜底
  return arxivCron.scheduled(controller, env, ctx);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    // Scheduled test endpoint: open in dev; in production requires the
    // CRON_TRIGGER_KEY secret via ?key= (ops escape hatch for manual runs).
    if (pathname === "/__scheduled") {
      const params = new URL(request.url).searchParams;
      if (
        env.ENVIRONMENT === "production" &&
        (!env.CRON_TRIGGER_KEY || params.get("key") !== env.CRON_TRIGGER_KEY)
      ) {
        return new Response("Not Found", { status: 404 });
      }
      // ?cron= chooses which scheduled handler to trigger.
      const cron = params.get("cron") ?? ARXIV_CRON;
      await dispatchScheduled(
        {
          scheduledTime: Date.now(),
          cron,
          noRetry: () => {},
        } as ScheduledController,
        env,
        ctx,
      );
      return new Response(`Scheduled handler triggered: ${cron}`, {
        status: 200,
      });
    }

    // 运维通道：重投 failed 的 arXiv 论文（与 /__scheduled 同门禁）。
    // 队列消息只能从 Worker 侧发、CLI 无法补投，这是 failed 论文唯一的正规
    // 重跑入口；只覆盖 arXiv 来源（用户上传的消息形状含 r2Key 等，不在此复原）。
    // 可选参数复原用户论文的形状：lang=<en|zh-cn|zh-tw|ja> 单语（缺省为 gallery
    // 四语），whiteboard=0 不出白板。BYOK/promptId 无法复原，重跑一律走系统 API；
    // 消息不带 generateWhiteboard 时即使再失败也不会触发错误退款（charged=false）。
    if (pathname === "/__ops/retry-paper") {
      const params = new URL(request.url).searchParams;
      if (
        env.ENVIRONMENT === "production" &&
        (!env.CRON_TRIGGER_KEY || params.get("key") !== env.CRON_TRIGGER_KEY)
      ) {
        return new Response("Not Found", { status: 404 });
      }
      const shortId = params.get("shortId");
      if (!shortId) return new Response("shortId required", { status: 400 });
      const langParam = params.get("lang");
      const lang = (["en", "zh-cn", "zh-tw", "ja"] as const).find(
        (l) => l === langParam,
      );
      if (langParam !== null && !lang) {
        return new Response("invalid lang", { status: 400 });
      }
      const wantWhiteboard = params.get("whiteboard") !== "0";
      const db = drizzle(env.DB);
      const [paper] = await db
        .select({
          id: papers.id,
          userId: papers.userId,
          sourceType: papers.sourceType,
          sourceUrl: papers.sourceUrl,
        })
        .from(papers)
        .where(
          and(
            eq(papers.shortId, shortId),
            eq(papers.status, "failed"),
            isNull(papers.deletedAt),
          ),
        )
        .limit(1);
      if (!paper || paper.sourceType !== "arxiv" || !paper.sourceUrl) {
        return new Response("not a retryable failed arxiv paper", {
          status: 404,
        });
      }
      await db
        .update(papers)
        .set({ status: "pending", errorMessage: null, updatedAt: new Date() })
        .where(eq(papers.id, paper.id));
      // 缺省形状对齐 createGalleryPaper 的初始入队（gallery 论文四语+白板）；
      // 带 lang 时按用户论文形状单语重投、不带 extraLanguages
      await env.PAPER_QUEUE.send({
        paperId: paper.id,
        userId: paper.userId,
        type: "initial",
        sourceType: "arxiv",
        arxivUrl: paper.sourceUrl,
        ...(lang
          ? { language: lang }
          : { extraLanguages: ["zh-cn", "zh-tw", "ja"] as const }),
        ...(wantWhiteboard ? { generateWhiteboard: true } : {}),
      });
      return new Response(`requeued ${shortId} (${paper.id})`, { status: 200 });
    }

    // 运维通道：按期重译简报的**单个**语言（与 /__scheduled 同门禁）。
    // 用途是回填 2026-08-29 那批没翻的 ja（出口校验上线前生成的存量）。
    // ids= 逗号分隔，每项可以是 digest id，也可以是 `slug#issue`（如
    // formal-math#3）；locale= 默认 ja；dry=1 只翻不写。
    // 逐期串行、每期译完立刻写回：客户端断连最多丢掉后面几期，已写回的那几期
    // 是完整的，而且重译幂等（源恒为 zh-cn），重跑即可。一次别传太多期——
    // 每期一次 LLM 调用，攒太长会把 HTTP 响应拖到超时。
    if (pathname === "/__ops/retranslate-digest") {
      const params = new URL(request.url).searchParams;
      if (
        env.ENVIRONMENT === "production" &&
        (!env.CRON_TRIGGER_KEY || params.get("key") !== env.CRON_TRIGGER_KEY)
      ) {
        return new Response("Not Found", { status: 404 });
      }
      const localeParam = params.get("locale") ?? "ja";
      const target = (["zh-tw", "en", "ja"] as const).find(
        (l) => l === localeParam,
      );
      if (!target) return new Response("invalid locale", { status: 400 });
      const refs = (params.get("ids") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (refs.length === 0)
        return new Response("ids required", { status: 400 });
      const dryRun = params.get("dry") === "1";

      const db = drizzle(env.DB);
      const results: unknown[] = [];
      for (const ref of refs) {
        const digestId = await resolveDigestRef(db, ref);
        if (!digestId) {
          results.push({ ref, status: "failed", detail: "unresolved ref" });
          continue;
        }
        try {
          results.push({
            ref,
            ...(await retranslateDigestLocale(db, env, digestId, target, {
              dryRun,
            })),
          });
        } catch (error) {
          // 译文没过语言校验也走这里：那一期原样保留，不写半成品
          results.push({
            ref,
            digestId,
            status: "failed",
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return Response.json({ locale: target, dryRun, results });
    }

    // /about 已下线(2026-08 首页重构): 301 保外链权重
    if (pathname === "/about" || pathname === "/about/") {
      return Response.redirect(new URL("/", request.url).toString(), 301);
    }

    // 公开论文的 Markdown 视图 (扩展名 / 内容协商), 命中则直接返回。
    if (pathname.startsWith("/p/")) {
      const md = await tryServePaperMarkdown(request, env);
      if (md) return md;
    }

    // env/ctx 由 @cloudflare/vite-plugin 的 cloudflare:workers async context 注入，
    // handler.fetch 只接收 (request, opts?)。
    // paraglideMiddleware 决定 SSR locale：cookie → Accept-Language(上面的
    // custom-negotiate 自实现协商) → baseLocale(en)，并把结果放进
    // AsyncLocalStorage 供渲染期 getLocale() 读取，消除 hydration mismatch。
    // TanStack Router 自己管 URL，按 server.js 文档示例传原始 request。
    let response = await paraglideMiddleware(request, () =>
      handler.fetch(request),
    );

    // 协商/重置出来的 locale 由 HTTP 下发 cookie：脚本执行前就进 document.cookie，
    // 客户端 hydration 那帧读到的和服务端渲染用的是同一个值。只挂在 HTML 响应上
    // （sitemap/rss/R2 等 public 可缓存响应不能带 cookie），同时给每个浏览器打上
    // 「已过修复后代码」的标记（见 locale-cookie-policy.ts）。
    if (isHtmlResponse(response)) {
      response = withLocaleCookies(
        response,
        decideRequestLocale(
          request.headers.get("cookie"),
          request.headers.get("accept-language"),
        ),
      );
    }

    // 下架的资讯回 410 而不是 404（见 lib/news/gone.ts）。必须在这里做而不是在
    // 路由 loader 里：SSR 响应的状态码取自 router.state.statusCode（见
    // react-router 的 renderRouterToStream），loader 侧的 setResponseStatus 改不
    // 动它，notFound() 一律落成 404。放在响应之后判，正常页面零额外开销。
    if (response.status === 404) {
      const gone = await goneIfHiddenStory(pathname, response, drizzle(env.DB));
      if (gone) return gone;
    }
    return response;
  },
  queue: queueConsumer.queue,
  scheduled: dispatchScheduled,
};
