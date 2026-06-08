import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";

interface AppEnvBindings {
  INDEXNOW_KEY?: string;
}

/**
 * IndexNow 的所有权验证文件。提交时 keyLocation 指向这里, 内容即为 key 本身。
 * 未配置 INDEXNOW_KEY 时返回 404 (功能整体关闭)。
 */
async function handler() {
  const appEnv = env as typeof env & AppEnvBindings;
  const key = appEnv.INDEXNOW_KEY;
  if (!key) {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(key, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export const Route = createFileRoute("/indexnow-key.txt")({
  server: {
    handlers: {
      GET: handler,
    },
  },
});
