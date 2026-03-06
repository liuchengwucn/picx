import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";

interface AppEnvBindings {
  PAPERS_BUCKET: R2Bucket;
}

async function handler({ request }: { request: Request }) {
  try {
    // 从 URL 中提取 R2 key
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 移除 /api/r2/ 前缀得到实际的 R2 key
    const r2Key = pathname.replace(/^\/api\/r2\//, "");

    if (!r2Key) {
      return new Response("Missing file key", { status: 400 });
    }

    // 访问 R2 bucket
    const appEnv = env as typeof env & AppEnvBindings;
    const bucket = appEnv.PAPERS_BUCKET;

    // 获取文件对象
    const object = await bucket.get(r2Key);

    if (!object) {
      return new Response("File not found", { status: 404 });
    }

    // 从 R2 metadata 获取 content type
    const contentType = object.httpMetadata?.contentType || "application/octet-stream";

    // 返回文件内容
    return new Response(object.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": object.etag,
      },
    });
  } catch (error) {
    console.error("Error fetching file from R2:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

export const Route = createFileRoute("/api/r2/$")({
  server: {
    handlers: {
      GET: handler,
    },
  },
});
