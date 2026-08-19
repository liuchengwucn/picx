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
import { buildLlmsFullTxt } from "#/lib/llms-txt";
import { publicPaperConditions } from "#/lib/paper-visibility";
import { SITE_URL } from "#/lib/site-url";

interface AppEnvBindings {
  DB: D1Database;
}

// 完整版字节上限。llms-full.txt 习惯在几十 KB 量级; 超出的论文/story 整篇丢弃并
// 注明, 避免静默截断。
const MAX_BYTES = 200_000;

// 新闻 story 的上限, 同样是"最新即可"的站点地图逻辑。
const MAX_STORIES = 100;

// 方向简报期数上限。正文整篇内联, 比 story 更占预算, 取最近若干期即可。
const MAX_DIGESTS = 30;

/**
 * `/llms-full.txt` —— 在 llms.txt 概要之上内联每篇公开论文的英文完整摘要,
 * 受字节预算约束。
 */
async function handler() {
  const appEnv = env as typeof env & AppEnvBindings;
  const db = drizzle(appEnv.DB);

  let rows: Array<{
    shortId: string | null;
    title: string;
    sourceType: string | null;
    sourceUrl: string | null;
    tldr: unknown;
    summaries: unknown;
  }> = [];
  try {
    rows = await db
      .select({
        shortId: papers.shortId,
        title: papers.title,
        sourceType: papers.sourceType,
        sourceUrl: papers.sourceUrl,
        tldr: paperResults.tldr,
        summaries: paperResults.summaries,
      })
      .from(papers)
      .leftJoin(paperResults, eq(paperResults.paperId, papers.id))
      // 不带白板条件: 与 llms.txt 同一个理由 —— 索引的是论文页面本身
      .where(and(...publicPaperConditions()))
      .orderBy(desc(papers.publishedAt));
  } catch {
    // Degrade to overview-only llms-full.txt
  }

  let digestRows: Array<{
    directionSlug: string;
    issueNumber: number;
    title: unknown;
    content: unknown;
  }> = [];
  try {
    digestRows = await db
      .select({
        directionSlug: directions.slug,
        issueNumber: digests.issueNumber,
        title: digests.title,
        content: digests.content,
      })
      .from(digests)
      .innerJoin(directions, eq(digests.directionId, directions.id))
      // isActive: 方向下线后期页已 404, 别再把全文喂给爬虫
      .where(
        and(eq(digests.status, "published"), eq(directions.isActive, true)),
      )
      .orderBy(desc(digests.publishedAt))
      .limit(MAX_DIGESTS);
  } catch {
    // Degrade to llms-full.txt without direction digests
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
    // Degrade to llms-full.txt without news stories
  }

  const txt = buildLlmsFullTxt({
    siteUrl: SITE_URL,
    maxBytes: MAX_BYTES,
    papers: rows
      .filter((r): r is typeof r & { shortId: string } => Boolean(r.shortId))
      .map((r) => {
        const summaries = r.summaries as Record<string, string> | null;
        const tldr = r.tldr as Record<string, string> | null;
        return {
          title: r.title,
          shortId: r.shortId,
          tldr: tldr?.en ?? null,
          summary: summaries?.en ?? null,
          sourceType: r.sourceType,
          sourceUrl: r.sourceUrl,
        };
      }),
    digests: digestRows
      .map((r) => ({
        directionSlug: r.directionSlug,
        issueNumber: r.issueNumber,
        title: (r.title as Record<string, string> | null)?.en ?? "",
        content: (r.content as Record<string, string> | null)?.en ?? "",
      }))
      .filter((d) => d.title !== "" && d.content !== ""),
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

export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: handler,
    },
  },
});
