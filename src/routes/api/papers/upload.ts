import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "#/lib/auth";
import { isPdfBuffer } from "#/lib/pdf-bytes";

/**
 * 论文 PDF 二进制直传：替代旧的 tRPC base64 中转（50MB 上限 + 双重编码内存压力）。
 * 上限对齐 MinerU 的 100MB。R2 key 约定与旧路径一致：papers/{userId}/{ts}-{filename}。
 */

// Worker 内存上限 128MB，缓冲整文件中转；Cloudflare 请求体上限多数套餐为 100MB，
// 故 100MB 是平台硬约束，而非随意选定的业务上限。
const MAX_PDF_BYTES = 100 * 1024 * 1024;

interface AppEnvBindings {
  PAPERS_BUCKET: R2Bucket;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sanitizeFilename(filename: string): string {
  // 旧 tRPC upload.uploadFile 未做任何清洗，直接把 filename 拼进 R2 key；
  // 这里补上基础清洗以避免路径分隔符/控制字符污染 R2 key。
  return filename.replace(/[^\w.-]+/g, "_").slice(0, 200);
}

async function handler({ request }: { request: Request }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return jsonError("You must be logged in to upload", 401);
  }

  const filename = new URL(request.url).searchParams.get("filename")?.trim();
  if (!filename) {
    return jsonError("Missing filename", 400);
  }

  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch {
    return jsonError("Failed to read upload body", 400);
  }
  const buffer = new Uint8Array(body);

  if (buffer.byteLength === 0) {
    return jsonError("Empty file", 400);
  }
  if (buffer.byteLength > MAX_PDF_BYTES) {
    return jsonError("File exceeds the 100MB limit", 413);
  }
  if (!isPdfBuffer(buffer)) {
    return jsonError("Uploaded file is not a valid PDF", 400);
  }

  const r2Key = `papers/${session.user.id}/${Date.now()}-${sanitizeFilename(filename)}`;
  await (env as typeof env & AppEnvBindings).PAPERS_BUCKET.put(r2Key, body, {
    httpMetadata: { contentType: "application/pdf" },
  });

  return new Response(JSON.stringify({ r2Key, fileSize: buffer.byteLength }), {
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/papers/upload")({
  server: {
    handlers: {
      POST: handler,
    },
  },
});
