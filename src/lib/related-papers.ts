import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { paperResults, papers } from "#/db/schema";

export interface RelatedPaper {
  shortId: string;
  title: string;
  publishedAt: Date | null;
  tldr: Record<string, string> | null;
}

/**
 * Merge category-matched candidates (primary) with recent-fallback candidates
 * into a deduped list of at most `limit`, category matches first. Pure so it
 * can be unit-tested without a database.
 */
export function mergeRelated(
  primary: RelatedPaper[],
  fallback: RelatedPaper[],
  limit: number,
): RelatedPaper[] {
  const out: RelatedPaper[] = [];
  const seen = new Set<string>();
  for (const p of [...primary, ...fallback]) {
    if (out.length >= limit) break;
    if (!p.shortId || seen.has(p.shortId)) continue;
    seen.add(p.shortId);
    out.push(p);
  }
  return out;
}

/**
 * Select papers related to the current one for the detail-page internal-link
 * module: papers sharing any category slug first (most relevant + helps Google
 * understand topical clustering), then the most recent public papers to fill
 * the remaining slots. Always returns real, crawlable internal links.
 */
export async function selectRelatedPapers<
  TSchema extends Record<string, unknown>,
>(
  db: DrizzleD1Database<TSchema>,
  opts: { excludePaperId: string; categories: string[]; limit?: number },
): Promise<RelatedPaper[]> {
  const limit = opts.limit ?? 3;
  const base = and(
    eq(papers.isPublic, true),
    eq(papers.isListedInGallery, true),
    eq(papers.status, "completed"),
    isNull(papers.deletedAt),
    ne(papers.id, opts.excludePaperId),
  );
  const columns = {
    shortId: papers.shortId,
    title: papers.title,
    publishedAt: papers.publishedAt,
    tldr: paperResults.tldr,
  };
  const toRelated = (
    rows: Array<{
      shortId: string | null;
      title: string;
      publishedAt: Date | null;
      tldr: Record<string, string> | null;
    }>,
  ): RelatedPaper[] =>
    rows.flatMap((r) =>
      r.shortId
        ? [
            {
              shortId: r.shortId,
              title: r.title,
              publishedAt: r.publishedAt,
              tldr: r.tldr,
            },
          ]
        : [],
    );

  // 1) same-category overlap: paper's categories JSON contains any of our slugs.
  //    Reuses the LIKE '%"slug"%' pattern already used by listPublic filtering.
  let primary: RelatedPaper[] = [];
  const cats = opts.categories.filter(Boolean);
  if (cats.length > 0) {
    const catMatch = or(
      ...cats.map(
        (slug) => sql`${paperResults.categories} LIKE ${`%"${slug}"%`}`,
      ),
    );
    const rows = await db
      .select(columns)
      .from(papers)
      .innerJoin(paperResults, eq(paperResults.paperId, papers.id))
      .where(and(base, catMatch))
      .orderBy(desc(papers.publishedAt))
      .limit(limit);
    primary = toRelated(rows);
  }

  // 2) fallback: most recent public papers, fetching enough to fill after dedup.
  let fallback: RelatedPaper[] = [];
  if (primary.length < limit) {
    const rows = await db
      .select(columns)
      .from(papers)
      .leftJoin(paperResults, eq(paperResults.paperId, papers.id))
      .where(base)
      .orderBy(desc(papers.publishedAt))
      .limit(limit + primary.length);
    fallback = toRelated(rows);
  }

  return mergeRelated(primary, fallback, limit);
}
