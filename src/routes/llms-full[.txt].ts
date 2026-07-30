import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { newsStories, paperResults, papers } from "#/db/schema";
import { buildLlmsFullTxt } from "#/lib/llms-txt";
import { SITE_URL } from "#/lib/site-url";

interface AppEnvBindings {
  DB: D1Database;
}

// 完整版字节上限。llms-full.txt 习惯在几十 KB 量级; 超出的论文/story 整篇丢弃并
// 注明, 避免静默截断。
const MAX_BYTES = 200_000;

// 新闻 story 的上限, 同样是"最新即可"的站点地图逻辑。
const MAX_STORIES = 100;

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
      .where(
        and(
          eq(papers.isPublic, true),
          eq(papers.isListedInGallery, true),
          eq(papers.status, "completed"),
          isNull(papers.deletedAt),
        ),
      )
      .orderBy(desc(papers.publishedAt));
  } catch {
    // Degrade to overview-only llms-full.txt
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
      .orderBy(desc(newsStories.firstSeenAt))
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
