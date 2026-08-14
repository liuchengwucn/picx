import { createFileRoute } from "@tanstack/react-router";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createTRPCContext } from "#/integrations/trpc/init";
import { trpcRouter } from "#/integrations/trpc/router";

function handler({ request }: { request: Request }) {
  return fetchRequestHandler({
    req: request,
    router: trpcRouter,
    endpoint: "/api/trpc",
    createContext: createTRPCContext,
    // errorFormatter 把未处理异常的 message 脱敏成固定文案，真实错误只能从这里出：
    // cause 才是原始异常（DrizzleQueryError 等），error 本身可能已是包装壳。
    onError({ error, path, type }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error(
          `[trpc] ${type} ${path ?? "<unknown>"} failed:`,
          error.cause ?? error,
        );
      }
    },
  });
}

export const Route = createFileRoute("/api/trpc/$")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
    },
  },
});
