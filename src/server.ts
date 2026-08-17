import handler from "@tanstack/react-start/server-entry";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { papers } from "#/db/schema";

// DO class 必须从 worker 入口导出，wrangler 才能按 class_name 找到它
export { ChatRunner } from "#/lib/chat-runner-do";

import { prefersMarkdown } from "#/lib/content-negotiation";
import { negotiateFromAcceptLanguage } from "#/lib/locale-negotiation";
import { loadPaperMarkdown } from "#/lib/paper-markdown";
import {
  cookieName,
  defineCustomServerStrategy,
  isLocale,
} from "#/paraglide/runtime";
import { paraglideMiddleware } from "#/paraglide/server.js";
import type { Env } from "#/types/env";
import arxivCron from "#/workers/arxiv-cron";
import digestCron from "#/workers/digest-cron";
import newsCron from "#/workers/news-cron";
import queueConsumer from "#/workers/queue-consumer";
import tweetPosterCron from "#/workers/tweet-poster-cron";

export { DigestWorkflow } from "#/workflows/digest-workflow";

// SSR locale 的 Accept-Language 兜底协商（cookie 没命中时走到这里）。
// 不能用 paraglide 内置的 preferredLanguage 策略：它的服务端实现会把语言标签
// toLowerCase 后原样返回（如 "zh-cn"），而 message 分发是 locale === "zh-CN"
// 精确比较、else 兜底是 ja → 中文用户会被渲染成日文。
// 注意：extractLocaleFromRequestAsync 会把 custom 策略排在所有内置策略之前执行
// （无视 strategy 数组里的顺序），所以这里必须先看 cookie——有合法 locale cookie
// 时返回 undefined 让位，内置 cookie 策略才能按预期优先生效。
defineCustomServerStrategy("custom-negotiate", {
  getLocale: (request?: Request) => {
    const cookieLocale = request?.headers
      .get("cookie")
      ?.split("; ")
      .find((c) => c.startsWith(`${cookieName}=`))
      ?.split("=")[1];
    if (isLocale(cookieLocale)) {
      return undefined;
    }
    return negotiateFromAcceptLanguage(request?.headers.get("accept-language"));
  },
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

    // 运维通道：重投 failed 的 gallery arXiv 论文（与 /__scheduled 同门禁）。
    // 队列消息只能从 Worker 侧发、CLI 无法补投，这是 failed 论文唯一的正规
    // 重跑入口；只覆盖 arXiv 来源（用户上传的消息形状含 r2Key 等，不在此复原）。
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
      // 消息形状对齐 createGalleryPaper 的初始入队（gallery 论文四语+白板）
      await env.PAPER_QUEUE.send({
        paperId: paper.id,
        userId: paper.userId,
        type: "initial",
        sourceType: "arxiv",
        arxivUrl: paper.sourceUrl,
        extraLanguages: ["zh-cn", "zh-tw", "ja"],
        generateWhiteboard: true,
      });
      return new Response(`requeued ${shortId} (${paper.id})`, { status: 200 });
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
    return paraglideMiddleware(request, () => handler.fetch(request));
  },
  queue: queueConsumer.queue,
  scheduled: dispatchScheduled,
};
