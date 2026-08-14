import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "#/db/schema";
import { papers } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  getReviewGuestServerSession,
  isReviewGuestModeEnabled,
} from "#/lib/review-guest";

/**
 * 论文原文图片的鉴权读取端点：/api/paper-content/{paperId}/images/{name}
 *
 * 私有论文的原文不可匿名读取，故不能走无鉴权的 /api/r2/$。规则与 paper.getContent
 * 一致：公开论文匿名可读；私有论文需登录（或 review-guest 预览模式）且是 owner。
 */

interface AppEnvBindings {
  DB: D1Database;
  PAPERS_BUCKET: R2Bucket;
}

// imageName 允许的字符与 mineru-zip 的 sanitizeStoredBasename 一致（无斜杠，
// 故不可能穿越到别的前缀）。
const SPLAT_RE = /^([0-9a-f-]{36})\/images\/([\w.-][\w.-]*)$/i;

async function handler({
  params,
  request,
}: {
  params: { _splat?: string };
  request: Request;
}) {
  const appEnv = env as typeof env & AppEnvBindings;
  const db = drizzle(appEnv.DB, { schema });

  const match = (params._splat ?? "").match(SPLAT_RE);
  if (!match) {
    return new Response("Not found", { status: 404 });
  }
  const [, paperId, imageName] = match;

  const [paper] = await db
    .select({ userId: papers.userId, isPublic: papers.isPublic })
    .from(papers)
    .where(and(eq(papers.id, paperId), isNull(papers.deletedAt)))
    .limit(1);
  if (!paper) {
    return new Response("Not found", { status: 404 });
  }

  // 公开论文的正文图片匿名可读——否则未登录访客拿到 markdown 却看到一屏裂图。
  // 私有论文才解析 session，顺序与 paper.getContent 保持一致。
  if (!paper.isPublic) {
    const session =
      (await auth.api.getSession({ headers: request.headers })) ??
      (isReviewGuestModeEnabled()
        ? await getReviewGuestServerSession(db)
        : null);
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (paper.userId !== session.user.id) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  const obj = await appEnv.PAPERS_BUCKET.get(
    `paper-content/${paperId}/images/${imageName}`,
  );
  if (!obj) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(obj.body, {
    headers: {
      "Content-Type":
        obj.httpMetadata?.contentType ?? "application/octet-stream",
      // contentType 源自 zip 内的扩展名，别让浏览器再去嗅探成 HTML/脚本
      "X-Content-Type-Options": "nosniff",
      // 内容不可变（同 key 不会被覆盖为不同图片），浏览器私有缓存即可。
      // 公开论文也不放 public：可见性随时可能被作者改回私有，共享缓存会继续
      // 分发已经撤回的正文图片。
      "Cache-Control": "private, max-age=31536000, immutable",
      // httpEtag 才是带引号的合法 entity-tag；裸的 etag 发出去是畸形校验器，
      // 浏览器会干脆不拿它做条件请求。
      ETag: obj.httpEtag,
    },
  });
}

export const Route = createFileRoute("/api/paper-content/$")({
  server: {
    handlers: {
      GET: handler,
    },
  },
});
