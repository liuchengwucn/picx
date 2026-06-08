import handler from "@tanstack/react-start/server-entry";
import { drizzle } from "drizzle-orm/d1";
import { prefersMarkdown } from "#/lib/content-negotiation";
import { loadPaperMarkdown } from "#/lib/paper-markdown";
import type { Env } from "#/types/env";
import arxivCron from "#/workers/arxiv-cron";
import queueConsumer from "#/workers/queue-consumer";
import tweetPosterCron from "#/workers/tweet-poster-cron";

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

async function dispatchScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  if (POSTER_CRONS.has(controller.cron)) {
    return tweetPosterCron.scheduled(controller, env, ctx);
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

    // Block scheduled test endpoint in production
    if (pathname === "/__scheduled") {
      if (env.ENVIRONMENT === "production") {
        return new Response("Not Found", { status: 404 });
      }
      // In dev, allow ?cron= to choose which scheduled handler to trigger.
      const cron = new URL(request.url).searchParams.get("cron") ?? ARXIV_CRON;
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

    // 公开论文的 Markdown 视图 (扩展名 / 内容协商), 命中则直接返回。
    if (pathname.startsWith("/p/")) {
      const md = await tryServePaperMarkdown(request, env);
      if (md) return md;
    }

    // env/ctx 由 @cloudflare/vite-plugin 的 cloudflare:workers async context 注入，
    // handler.fetch 只接收 (request, opts?)。
    return handler.fetch(request);
  },
  queue: queueConsumer.queue,
  scheduled: dispatchScheduled,
};
