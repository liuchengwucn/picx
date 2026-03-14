import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, isNull } from "drizzle-orm";
import { papers } from "#/db/schema";

interface AppEnvBindings {
  DB: D1Database;
}

async function handler({ request }: { request: Request }) {
  const origin = new URL(request.url).origin;
  const appEnv = env as typeof env & AppEnvBindings;
  const db = drizzle(appEnv.DB);

  // Fetch all public gallery papers (id + publishedAt only)
  let publicPapers: Array<{ id: string; publishedAt: Date | null }> = [];
  try {
    publicPapers = await db
      .select({ id: papers.id, publishedAt: papers.publishedAt })
      .from(papers)
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
    // Degrade gracefully to static-only sitemap
  }

  const staticRoutes = [
    { url: `${origin}/`, priority: "1.0", changefreq: "weekly" },
    { url: `${origin}/gallery`, priority: "0.9", changefreq: "daily" },
    { url: `${origin}/about`, priority: "0.5", changefreq: "monthly" },
  ];

  const paperRoutes = publicPapers.map((p) => ({
    url: `${origin}/papers/${p.id}`,
    priority: "0.7",
    changefreq: "never",
    lastmod: p.publishedAt
      ? p.publishedAt.toISOString().split("T")[0]
      : undefined,
  }));

  const allRoutes = [...staticRoutes, ...paperRoutes];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allRoutes
  .map(
    (r) => `  <url>
    <loc>${r.url}</loc>
    ${r.lastmod ? `<lastmod>${r.lastmod}</lastmod>` : ""}
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
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
