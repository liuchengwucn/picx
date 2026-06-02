import handler from "@tanstack/react-start/server-entry";
import type { Env } from "#/types/env";
import arxivCron from "#/workers/arxiv-cron";
import queueConsumer from "#/workers/queue-consumer";
import tweetPosterCron from "#/workers/tweet-poster-cron";

const ARXIV_CRON = "0 0 * * *";
const POSTER_CRON = "0 14 * * *";

async function dispatchScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  switch (controller.cron) {
    case POSTER_CRON:
      return tweetPosterCron.scheduled(controller, env, ctx);
    default:
      // ARXIV_CRON 及兜底
      return arxivCron.scheduled(controller, env, ctx);
  }
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

    return handler.fetch(request, env, ctx);
  },
  queue: queueConsumer.queue,
  scheduled: dispatchScheduled,
};
