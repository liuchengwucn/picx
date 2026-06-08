import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { paperResults, papers } from "#/db/schema";
import { buildLlmsTxt } from "#/lib/llms-txt";
import { SITE_URL } from "#/lib/site-url";

interface AppEnvBindings {
  DB: D1Database;
}

// 平铺索引的上限。画廊客户端渲染、爬虫看不到列表, llms.txt 是它们的站点地图,
// 取最新 N 篇即可, 太长反而稀释信号。
const MAX_PAPERS = 200;

/**
 * `/llms.txt` —— 给 AI 爬虫的站点入口: 站点概要 + 关键页面 + 最新公开论文索引,
 * 每篇指向其 `.md` 视图。
 */
async function handler() {
  const appEnv = env as typeof env & AppEnvBindings;
  const db = drizzle(appEnv.DB);

  let rows: Array<{
    shortId: string | null;
    title: string;
    tldr: unknown;
  }> = [];
  try {
    rows = await db
      .select({
        shortId: papers.shortId,
        title: papers.title,
        tldr: paperResults.tldr,
      })
      .from(papers)
      .leftJoin(paperResults, eq(paperResults.paperId, papers.id))
      .where(
        and(
          eq(papers.isPublic, true),
          eq(papers.isListedInGallery, true),
          eq(papers.status, "completed"),
          isNull(papers.deletedAt),
        ),
      )
      .orderBy(desc(papers.publishedAt))
      .limit(MAX_PAPERS);
  } catch {
    // Degrade to overview-only llms.txt
  }

  const txt = buildLlmsTxt({
    siteUrl: SITE_URL,
    papers: rows
      .filter((r): r is typeof r & { shortId: string } => Boolean(r.shortId))
      .map((r) => ({
        title: r.title,
        shortId: r.shortId,
        tldr: (r.tldr as Record<string, string> | null)?.en ?? null,
      })),
  });

  return new Response(txt, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: handler,
    },
  },
});
