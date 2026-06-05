import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "#/lib/auth";
import { createBatch } from "#/lib/mineru";

/**
 * PDF 上传中转：浏览器把 PDF 字节 POST 到本路由，服务端建 MinerU 批次并把字节
 * PUT 到其返回的 OSS 签名地址，只回 batchId。
 *
 * 为何不让浏览器直传 OSS：MinerU 的签名地址指向阿里云 OSS，该桶未对浏览器配置
 * CORS，跨域 PUT 预检会被 403 拦下（前端表现为 "Failed to fetch"）。Worker 的
 * fetch 不受 CORS 约束，故必须经服务端中转。
 *
 * 关键：PUT 时绝不能设置 Content-Type —— OSS 预签名签名里该字段为空，设了即签名
 * 不匹配 → 403（已实测验证）。传入 ArrayBuffer/Uint8Array 不会自动附带 Content-Type。
 */

// Worker 内存上限 128MB，缓冲整文件中转；Cloudflare 请求体上限多数套餐为 100MB。
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

interface AppEnvBindings {
  MINERU_TOKEN?: string;
}

function isPdfBuffer(buffer: Uint8Array): boolean {
  return PDF_SIGNATURE.every((byte, index) => buffer[index] === byte);
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handler({ request }: { request: Request }) {
  // 鉴权：复用 better-auth 服务端会话校验（review-guest 无真实会话，自然被拦）。
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

  const token = (env as typeof env & AppEnvBindings).MINERU_TOKEN;
  if (!token) {
    return jsonError("MINERU_TOKEN not configured", 500);
  }

  try {
    const { batchId, uploadUrl } = await createBatch(token, {
      filename,
      size: buffer.byteLength,
    });

    // 直传 OSS：不带任何自定义头，尤其不能设 Content-Type（见文件头注释）。
    const put = await fetch(uploadUrl, { method: "PUT", body });
    if (!put.ok) {
      console.error("OSS upload failed:", put.status, await put.text());
      return jsonError("Failed to upload file to MinerU", 502);
    }

    return new Response(JSON.stringify({ batchId }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Reader upload failed:", error);
    return jsonError("Failed to start conversion", 500);
  }
}

export const Route = createFileRoute("/api/reader/upload")({
  server: {
    handlers: {
      POST: handler,
    },
  },
});
