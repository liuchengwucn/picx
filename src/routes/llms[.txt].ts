import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  digests,
  directions,
  newsStories,
  paperResults,
  papers,
} from "#/db/schema";
import { buildLlmsTxt } from "#/lib/llms-txt";
import { publicPaperConditions } from "#/lib/paper-visibility";
import { SITE_URL } from "#/lib/site-url";

interface AppEnvBindings {
  DB: D1Database;
}

// 平铺索引的上限。画廊客户端渲染、爬虫看不到列表, llms.txt 是它们的站点地图,
// 取最新 N 篇即可, 太长反而稀释信号。
const MAX_PAPERS = 200;

// 新闻 story 的上限, 同样是"最新即可"的站点地图逻辑。
const MAX_STORIES = 100;

// 方向简报期数上限, 同上; 出刊节奏低, 这个数够覆盖很长的历史。
const MAX_DIGESTS = 100;

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
      // 不带白板条件: 索引的是论文页面本身, 有没有配图与能不能被抓取无关
      // (画廊流那套更窄的口径见 lib/paper-visibility.ts)
      .where(and(...publicPaperConditions()))
      .orderBy(desc(papers.publishedAt))
      .limit(MAX_PAPERS);
  } catch {
    // Degrade to overview-only llms.txt
  }

  let digestRows: Array<{
    directionSlug: string;
    issueNumber: number;
    title: unknown;
  }> = [];
  try {
    digestRows = await db
      .select({
        directionSlug: directions.slug,
        issueNumber: digests.issueNumber,
        title: digests.title,
      })
      .from(digests)
      .innerJoin(directions, eq(digests.directionId, directions.id))
      // isActive: 方向下线后期页已 404, 别再往 llms.txt 里挂死链
      .where(
        and(eq(digests.status, "published"), eq(directions.isActive, true)),
      )
      .orderBy(desc(digests.publishedAt))
      .limit(MAX_DIGESTS);
  } catch {
    // Degrade to llms.txt without direction digests
  }

  let storyRows: Array<{
    shortId: string;
    title: unknown;
    summary: unknown;
  }> = [];
  try {
    storyRows = await db
      .select({
        shortId: newsStories.shortId,
        title: newsStories.title,
        summary: newsStories.summary,
      })
      .from(newsStories)
      // 字面量谓词：partial index 要求，勿改成 ne()/eq()；dirty=0 排除未生成四语摘要的占位 story
      .where(
        sql`${newsStories.status} != 'hidden' AND ${newsStories.dirty} = 0`,
      )
      .orderBy(desc(newsStories.earliestPublishedAt))
      .limit(MAX_STORIES);
  } catch {
    // Degrade to llms.txt without news stories
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
    digests: digestRows
      .map((r) => ({
        directionSlug: r.directionSlug,
        issueNumber: r.issueNumber,
        title: (r.title as Record<string, string> | null)?.en ?? "",
      }))
      .filter((d) => d.title !== ""),
    stories: storyRows
      .map((r) => ({
        shortId: r.shortId,
        title: (r.title as Record<string, string>).en ?? "",
        summary: (r.summary as Record<string, string>).en ?? "",
      }))
      .filter((s) => s.title !== ""),
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
