import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  digests,
  directions,
  newsStories,
  papers,
  whiteboardImages,
} from "#/db/schema";
import { escapeHtml } from "#/lib/embed-code";
import { PAPER_CATEGORY_SLUGS } from "#/lib/paper-categories";
import {
  defaultWhiteboardOn,
  publicPaperConditions,
} from "#/lib/paper-visibility";

interface AppEnvBindings {
  DB: D1Database;
}

async function handler({ request }: { request: Request }) {
  const origin = new URL(request.url).origin;
  const appEnv = env as typeof env & AppEnvBindings;
  const db = drizzle(appEnv.DB);

  // Fetch all public gallery papers. LEFT JOIN the default whiteboard so we can
  // emit an <image:image> entry (Google Images discovery) for papers that have
  // one — the stable /p/{shortId}/image route serves exactly that default image.
  let publicPapers: Array<{
    id: string;
    shortId: string | null;
    title: string;
    publishedAt: Date | null;
    whiteboardKey: string | null;
  }> = [];
  try {
    const rows = await db
      .select({
        id: papers.id,
        shortId: papers.shortId,
        title: papers.title,
        publishedAt: papers.publishedAt,
        whiteboardKey: whiteboardImages.imageR2Key,
      })
      .from(papers)
      // leftJoin 是刻意的: sitemap 收录的是「这个页面能不能被访问」, 有没有配图只
      // 决定要不要发 image 条目。别改成画廊流那种 innerJoin —— 那会把无图论文整条
      // 从 sitemap 里删掉。见 lib/paper-visibility.ts。
      .leftJoin(whiteboardImages, defaultWhiteboardOn())
      .where(and(...publicPaperConditions()))
      .orderBy(desc(papers.publishedAt));
    // Defensive dedup: default whiteboard should be unique per paper, but the
    // join would duplicate a paper row if that invariant ever broke.
    const seen = new Set<string>();
    publicPapers = rows.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  } catch {
    // Degrade gracefully to static-only sitemap
  }

  let stories: Array<{ shortId: string; lastActivityAt: Date }> = [];
  try {
    stories = await db
      .select({
        shortId: newsStories.shortId,
        lastActivityAt: newsStories.lastActivityAt,
      })
      .from(newsStories)
      // 字面量谓词：partial index 要求，勿改成 ne()/eq()；dirty=0 排除未生成四语摘要的占位 story
      .where(
        sql`${newsStories.status} != 'hidden' AND ${newsStories.dirty} = 0`,
      )
      .orderBy(desc(newsStories.earliestPublishedAt))
      .limit(1000);
  } catch {
    // Degrade gracefully to sitemap without news stories
  }

  let digestIssues: Array<{
    slug: string;
    issueNumber: number;
    updatedAt: Date;
  }> = [];
  try {
    digestIssues = await db
      .select({
        slug: directions.slug,
        issueNumber: digests.issueNumber,
        updatedAt: digests.updatedAt,
      })
      .from(digests)
      .innerJoin(directions, eq(digests.directionId, directions.id))
      // isActive 与下面 activeDirections 同一条件: 下线方向的期页已 404,
      // 留在 sitemap 里就是让爬虫去撞 404
      .where(
        and(eq(digests.status, "published"), eq(directions.isActive, true)),
      )
      .orderBy(desc(digests.publishedAt));
  } catch {
    // Degrade gracefully to sitemap without digest issues
  }

  let activeDirections: Array<{ slug: string }> = [];
  try {
    activeDirections = await db
      .select({ slug: directions.slug })
      .from(directions)
      .where(eq(directions.isActive, true))
      .orderBy(directions.sortOrder);
  } catch {
    // Degrade gracefully to sitemap without direction hubs
  }

  // publicPapers 已按 publishedAt 倒序, 取最新一篇的发布日作为首页/画廊的
  // lastmod —— 在 sitemap 顶部给出"内容刚更新"的新鲜度信号, 这是 Google
  // 现在真正参考的字段 (changefreq/priority 已被忽略)。
  const latestPaperDate = publicPapers[0]?.publishedAt
    ? publicPapers[0].publishedAt.toISOString().split("T")[0]
    : undefined;

  type SitemapRoute = {
    url: string;
    priority: string;
    changefreq: string;
    lastmod?: string;
    image?: { loc: string; title: string };
  };

  const staticRoutes: SitemapRoute[] = [
    {
      url: `${origin}/`,
      priority: "1.0",
      changefreq: "daily",
      lastmod: latestPaperDate,
    },
    {
      url: `${origin}/gallery`,
      priority: "0.9",
      changefreq: "daily",
      lastmod: latestPaperDate,
    },
    { url: `${origin}/news`, priority: "0.8", changefreq: "hourly" },
  ];

  const paperRoutes: SitemapRoute[] = publicPapers.map((p) => ({
    url: `${origin}/p/${p.shortId}`,
    priority: "0.7",
    changefreq: "never",
    lastmod: p.publishedAt
      ? p.publishedAt.toISOString().split("T")[0]
      : undefined,
    image: p.whiteboardKey
      ? { loc: `${origin}/p/${p.shortId}/image`, title: p.title }
      : undefined,
  }));

  const categoryRoutes: SitemapRoute[] = PAPER_CATEGORY_SLUGS.filter(
    (s) => s !== "other",
  ).map((slug) => ({
    url: `${origin}/gallery/c/${slug}`,
    priority: "0.7",
    changefreq: "daily",
    lastmod: latestPaperDate,
  }));

  const storyRoutes: SitemapRoute[] = stories.map((s) => ({
    url: `${origin}/news/${s.shortId}`,
    priority: "0.6",
    changefreq: "daily",
    lastmod: s.lastActivityAt.toISOString().split("T")[0],
  }));

  // 已发布简报期页: 定稿后基本不再变动, lastmod 用该期最后一次写入时间。
  const digestRoutes: SitemapRoute[] = digestIssues.map((d) => ({
    url: `${origin}/gallery/d/${d.slug}/${d.issueNumber}`,
    priority: "0.6",
    changefreq: "monthly",
    lastmod: d.updatedAt.toISOString().split("T")[0],
  }));

  // 方向主页是栏目页 (对齐 /gallery/c/{slug} 的 0.7), 但只在新一期发布时才变,
  // 所以 lastmod 取该方向最新一期的时间, changefreq 按出刊节奏给 weekly。
  const latestIssueDateBySlug = new Map<string, string>();
  for (const d of digestIssues) {
    const day = d.updatedAt.toISOString().split("T")[0];
    const prev = latestIssueDateBySlug.get(d.slug);
    if (!prev || day > prev) latestIssueDateBySlug.set(d.slug, day);
  }
  const directionRoutes: SitemapRoute[] = activeDirections.map((d) => ({
    url: `${origin}/gallery/d/${d.slug}`,
    priority: "0.7",
    changefreq: "weekly",
    lastmod: latestIssueDateBySlug.get(d.slug),
  }));

  const allRoutes = [
    ...staticRoutes,
    ...categoryRoutes,
    ...directionRoutes,
    ...paperRoutes,
    ...digestRoutes,
    ...storyRoutes,
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${allRoutes
  .map(
    (r) => `  <url>
    <loc>${r.url}</loc>
    ${r.lastmod ? `<lastmod>${r.lastmod}</lastmod>` : ""}
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>${
      r.image
        ? `
    <image:image>
      <image:loc>${r.image.loc}</image:loc>
      <image:title>${escapeHtml(r.image.title)}</image:title>
    </image:image>`
        : ""
    }
  </url>`,
  )
  .join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: handler,
    },
  },
});
