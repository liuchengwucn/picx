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
 * 原文视图「仅登录可见」，故不能走无鉴权的 /api/r2/$。规则与 paper.getContent
 * 一致：登录（或 review-guest 预览模式）+ owner-或-公开论文。
 */

interface AppEnvBindings {
  DB: D1Database;
  PAPERS_BUCKET: R2Bucket;
}

const SPLAT_RE = /^([0-9a-f-]{36})\/images\/([\w][\w.-]*)$/i;

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

  const session =
    (await auth.api.getSession({ headers: request.headers })) ??
    (isReviewGuestModeEnabled() ? await getReviewGuestServerSession(db) : null);
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const [paper] = await db
    .select({ userId: papers.userId, isPublic: papers.isPublic })
    .from(papers)
    .where(and(eq(papers.id, paperId), isNull(papers.deletedAt)))
    .limit(1);
  if (!paper) {
    return new Response("Not found", { status: 404 });
  }
  const isOwner = paper.userId === session.user.id;
  if (!isOwner && !paper.isPublic) {
    return new Response("Forbidden", { status: 403 });
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
      // 内容不可变（同 key 不会被覆盖为不同图片），浏览器私有缓存即可
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: obj.etag,
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
