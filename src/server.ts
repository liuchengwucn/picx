import handler from "@tanstack/react-start/server-entry";
import type { Env } from "#/types/env";
import arxivCron from "#/workers/arxiv-cron";
import queueConsumer from "#/workers/queue-consumer";

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
      // In dev, trigger scheduled handler directly
      await arxivCron.scheduled(
        { scheduledTime: Date.now(), cron: "0 0 * * *", noRetry: () => {} } as ScheduledController,
        env,
        ctx,
      );
      return new Response("Scheduled handler triggered", { status: 200 });
    }

    return handler.fetch(request, env, ctx);
  },
  queue: queueConsumer.queue,
  scheduled: arxivCron.scheduled,
};
