import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { parseRangeHeader, servedRange, toR2Range } from "#/lib/http-range";

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

    // paper-content/（原文 markdown+图片）与 paper-text/（chatbot 用全文纯文本）
    // 都含私有论文的正文：前者受鉴权端点 /api/paper-content/ 保护（那里按 isPublic
    // 逐篇判定），后者只应被服务端（chatbot readPaper / queue-consumer）经 R2
    // binding 直读。本路由无从判定归属，一律不放行——公开论文的正文请走
    // /api/paper-content/。用 404 而非 403，避免泄露前缀是否存在。
    if (r2Key.startsWith("paper-content/") || r2Key.startsWith("paper-text/")) {
      return new Response("File not found", { status: 404 });
    }

    // 访问 R2 bucket
    const appEnv = env as typeof env & AppEnvBindings;
    const bucket = appEnv.PAPERS_BUCKET;

    // 语法非法的 Range 一律降级成 200 全量：RFC 允许服务端忽略 Range，比回 416 更耐用
    const requested = toR2Range(parseRangeHeader(request.headers.get("Range")));

    let object: R2ObjectBody | null = null;
    let isRangeResponse = false;
    if (requested) {
      // 语法合法但越界（offset ≥ 对象大小）时 R2 抛 InvalidRange 而不是返回 null，
      // 不在这里兜住就会被外层 catch 变成 500。抛错用 undefined 表示，好跟「key
      // 不存在」的 null 区分开——后者直接 404，不必再白读一次。
      const ranged = await bucket
        .get(r2Key, { range: requested })
        .catch((error: unknown) => {
          console.warn(
            "R2 ranged get failed, falling back to full object:",
            error,
          );
          return undefined;
        });
      if (ranged === null) {
        return new Response("File not found", { status: 404 });
      }
      if (ranged) {
        object = ranged;
        isRangeResponse = true;
      }
    }
    object ??= await bucket.get(r2Key);

    if (!object) {
      return new Response("File not found", { status: 404 });
    }

    // 从 R2 metadata 获取 content type
    const contentType =
      object.httpMetadata?.contentType || "application/octet-stream";

    // pdf.js 要看到 Accept-Ranges 与 Content-Length 同时存在才会启用分块下载，
    // 只给 Accept-Ranges 它会退回「整份下完再渲染」。
    //
    // immutable 在这里不是乐观估计而是事实：本端点的 key 天生内容唯一
    // （`whiteboards/${paperId}/${randomUUID()}.png`、`papers/${userId}/${Date.now()}-….pdf`），
    // 同一个 key 下的字节永不改变。这正是「不实现 If-Range 也安全」的前提——
    // 浏览器把 206 分片攒进 sparse cache entry 后无需重新校验，也不可能拼出
    // 混了两个版本的文件。哪天引入了会被覆盖的 key，这条就得重新算。
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
      // 必须用 httpEtag（带引号的合法 entity-tag）而不是裸的 etag：畸形校验器会让
      // 浏览器干脆不把它当校验器，分片缓存复用随之失效。
      ETag: object.httpEtag,
    };

    // object.size 始终是完整对象大小，所以能直接当 Content-Range 的分母
    const served = isRangeResponse ? servedRange(object.range) : undefined;
    if (served) {
      const end = served.offset + served.length - 1;
      headers["Content-Range"] = `bytes ${served.offset}-${end}/${object.size}`;
      headers["Content-Length"] = String(served.length);
      return new Response(object.body, { status: 206, headers });
    }

    // 只有全量 body 才配得上 object.size 这个 Content-Length。区间 body 却收窄失败
    // 时（目前不可达）宁可不发，退化成 chunked——降级但诚实，总好过让客户端死等
    // 永远不会到来的字节。
    if (!isRangeResponse) headers["Content-Length"] = String(object.size);
    return new Response(object.body, { headers });
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
