import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  GalleryCard,
  GalleryCardSkeleton,
  getCategoryLabel,
} from "#/components/papers/gallery-card";
import { useTRPC } from "#/integrations/trpc/react";
import {
  isValidCategorySlug,
  PAPER_CATEGORY_SLUGS,
} from "#/lib/paper-categories";
import { SITE_URL } from "#/lib/site-url";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

export const Route = createFileRoute("/gallery/c/$slug")({
  beforeLoad: ({ params }) => {
    if (!isValidCategorySlug(params.slug)) throw notFound();
  },
  component: CategoryPage,
  head: ({ params }) => {
    const name = getCategoryLabel(params.slug);
    const title = m.category_page_title({ category: name });
    const description = m.category_page_description({ category: name });
    const url = `${SITE_URL}/gallery/c/${params.slug}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
});

const SKELETON_KEYS = Array.from(
  { length: 6 },
  (_, i) => `cat-skeleton-${i + 1}`,
);

function CategoryPage() {
  const { slug } = Route.useParams();
  const name = getCategoryLabel(slug);
  const trpc = useTRPC();

  const query = useQuery(
    trpc.paper.listPublic.queryOptions({
      page: 1,
      limit: 12,
      locale: getLocale(),
      categories: [slug],
      sort: "recent",
    }),
  );

  const otherCategories = PAPER_CATEGORY_SLUGS.filter(
    (s) => s !== slug && s !== "other",
  );

  return (
    <main className="min-h-dvh bg-[var(--bg)] py-8">
      <div className="page-wrap">
        {/* Header */}
        <div className="rise-in mb-8 text-center">
          <h1 className="mb-3 font-serif text-4xl font-bold text-[var(--ink)] sm:text-5xl">
            {name}
          </h1>
          <p className="text-lg text-[var(--ink-soft)]">
            {m.category_page_description({ category: name })}
          </p>
        </div>

        {/* Gallery Grid */}
        {query.isLoading ? (
          <div className="grid auto-rows-fr gap-5 lg:grid-cols-2">
            {SKELETON_KEYS.map((k) => (
              <GalleryCardSkeleton key={k} />
            ))}
          </div>
        ) : query.data && query.data.papers.length > 0 ? (
          <div className="grid auto-rows-fr gap-5 lg:grid-cols-2">
            {query.data.papers.map((paper, index) => (
              <GalleryCard
                key={paper.id}
                paper={paper}
                delay={`${index * 50}ms`}
              />
            ))}
          </div>
        ) : (
          <div className="rise-in py-16 text-center">
            <p className="text-base text-[var(--ink-soft)]">
              {m.explore_empty_description()}
            </p>
          </div>
        )}

        {/* Inter-category nav */}
        <nav className="mt-12 border-t border-[var(--line)] pt-8">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link
              to="/gallery/archive"
              activeOptions={{ exact: true }}
              className="shrink-0 rounded-full border border-[var(--academic-brown)] px-3 py-1 text-xs font-medium text-[var(--academic-brown)] transition-colors hover:bg-[var(--academic-brown)] hover:text-white no-underline"
            >
              {m.archive_back()}
            </Link>
            {otherCategories.map((s) => (
              <Link
                key={s}
                to="/gallery/c/$slug"
                params={{ slug: s }}
                className="shrink-0 rounded-full border border-[var(--line)] px-3 py-1 text-xs font-medium text-[var(--ink-soft)] transition-colors hover:border-[var(--academic-brown)] hover:text-[var(--academic-brown)] no-underline"
              >
                {getCategoryLabel(s)}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </main>
  );
}
