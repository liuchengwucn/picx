import handler from "@tanstack/react-start/server-entry";
import type { Env } from "#/types/env";
import arxivCron from "#/workers/arxiv-cron";
import queueConsumer from "#/workers/queue-consumer";
import tweetPosterCron from "#/workers/tweet-poster-cron";

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

    // env/ctx 由 @cloudflare/vite-plugin 的 cloudflare:workers async context 注入，
    // handler.fetch 只接收 (request, opts?)。
    return handler.fetch(request);
  },
  queue: queueConsumer.queue,
  scheduled: dispatchScheduled,
};
