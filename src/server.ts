import handler from "@tanstack/react-start/server-entry";
import type { Env } from "#/types/env";
import queueConsumer from "#/workers/queue-consumer";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return handler.fetch(request, env, ctx);
  },
  queue: queueConsumer.queue,
};
