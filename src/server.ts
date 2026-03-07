import handler from "@tanstack/react-start/server-entry";
import type { Env } from "#/types/env";
import dailyCreditBonus from "#/workers/daily-credit-bonus";
import queueConsumer from "#/workers/queue-consumer";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Block scheduled test endpoints in production
    // These endpoints are only for local testing with Miniflare/Wrangler
    if (
      (url.pathname === "/__scheduled" ||
        url.pathname === "/cdn-cgi/handler/scheduled" ||
        url.pathname === "/cdn-cgi/mf/scheduled") &&
      env.ENVIRONMENT === "production"
    ) {
      return new Response("Not Found", { status: 404 });
    }

    return handler.fetch(request, env, ctx);
  },
  queue: queueConsumer.queue,
  scheduled: dailyCreditBonus.scheduled,
};
