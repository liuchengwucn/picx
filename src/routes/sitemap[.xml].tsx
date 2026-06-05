import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { papers, whiteboardImages } from "#/db/schema";
import { escapeHtml } from "#/lib/embed-code";
import { PAPER_CATEGORY_SLUGS } from "#/lib/paper-categories";

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
      .leftJoin(
        whiteboardImages,
        and(
          eq(whiteboardImages.paperId, papers.id),
          eq(whiteboardImages.isDefault, true),
        ),
      )
      .where(
        and(
          eq(papers.isPublic, true),
          eq(papers.isListedInGallery, true),
          eq(papers.status, "completed"),
          isNull(papers.deletedAt),
        ),
      )
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
      changefreq: "weekly",
      lastmod: latestPaperDate,
    },
    {
      url: `${origin}/gallery`,
      priority: "0.9",
      changefreq: "daily",
      lastmod: latestPaperDate,
    },
    { url: `${origin}/reader`, priority: "0.8", changefreq: "monthly" },
    { url: `${origin}/about`, priority: "0.5", changefreq: "monthly" },
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

  const allRoutes = [...staticRoutes, ...categoryRoutes, ...paperRoutes];

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
