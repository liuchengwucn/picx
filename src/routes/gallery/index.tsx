import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Globe, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/gallery/")({
  component: ExplorePage,
  head: () => ({
    meta: [
      { title: m.page_title_gallery() },
      {
        name: "description",
        content:
          "Browse visual whiteboard summaries of today's top HuggingFace research papers, automatically updated daily.",
      },
      { property: "og:title", content: m.page_title_gallery() },
      {
        property: "og:description",
        content:
          "Browse visual whiteboard summaries of today's top HuggingFace research papers, automatically updated daily.",
      },
      { property: "og:url", content: "https://picx.cn/gallery" },
    ],
  }),
});

const gallerySkeletonKeys = [
  "gallery-skeleton-1",
  "gallery-skeleton-2",
  "gallery-skeleton-3",
  "gallery-skeleton-4",
  "gallery-skeleton-5",
  "gallery-skeleton-6",
  "gallery-skeleton-7",
  "gallery-skeleton-8",
  "gallery-skeleton-9",
  "gallery-skeleton-10",
  "gallery-skeleton-11",
  "gallery-skeleton-12",
];

function ExplorePage() {
  const [page, setPage] = useState(1);
  const trpc = useTRPC();

  const galleryQuery = useQuery(
    trpc.paper.listPublic.queryOptions({
      page,
      limit: 12,
    }),
  );

  const totalPages = Math.ceil((galleryQuery.data?.total ?? 0) / 12);

  return (
    <main className="min-h-screen bg-[var(--bg)] py-8">
      <div className="page-wrap">
        {/* Header */}
        <div className="rise-in mb-8 text-center">
          <h1 className="mb-3 font-serif text-4xl font-bold text-[var(--ink)] sm:text-5xl">
            {m.explore_title()}
          </h1>
          <p className="text-lg text-[var(--ink-soft)]">
            {m.explore_description()}
          </p>
        </div>

        {/* Gallery Grid */}
        {galleryQuery.isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {gallerySkeletonKeys.map((skeletonKey) => (
              <GalleryCardSkeleton key={skeletonKey} />
            ))}
          </div>
        ) : galleryQuery.data?.papers.length === 0 ? (
          <EmptyGallery />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {galleryQuery.data?.papers.map((paper, index) => (
              <GalleryCard
                key={paper.id}
                paper={paper}
                delay={`${index * 50}ms`}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-12 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="gap-1.5"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2 text-sm font-medium text-[var(--ink)] shadow-[0_2px_8px_rgba(45,42,36,0.06)]">
              <span>{page}</span>
              <span className="text-[var(--ink-soft)]">/</span>
              <span>{totalPages}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="gap-1.5"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}

interface GalleryCardProps {
  paper: {
    id: string;
    shortId?: string;
    title: string;
    whiteboardImageR2Key: string;
    publishedAt: Date | null;
  };
  delay: string;
}

function GalleryCard({ paper, delay }: GalleryCardProps) {
  const imageUrl = `/api/r2/${paper.whiteboardImageR2Key}`;
  const timeAgo = getTimeAgo(paper.publishedAt);

  return (
    <Link
      to={paper.shortId ? "/p/$shortId" : "/papers/$paperId"}
      params={paper.shortId ? { shortId: paper.shortId } : { paperId: paper.id }}
      className="rise-in group block no-underline"
      style={{ animationDelay: delay }}
    >
      <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] shadow-[0_4px_16px_rgba(45,42,36,0.08)] transition-all hover:-translate-y-2 hover:shadow-[0_12px_32px_rgba(139,111,71,0.16)]">
        {/* Whiteboard Image */}
        <div className="relative aspect-[4/3] overflow-hidden bg-[var(--parchment-warm)]">
          <img
            src={imageUrl}
            alt={paper.title}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--surface-strong)] via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-60" />

          {/* Floating badge on hover */}
          <div className="absolute top-3 right-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            <div className="flex items-center gap-1.5 rounded-full border border-white/80 bg-white/90 px-3 py-1.5 text-xs font-medium text-[var(--ink)] shadow-lg backdrop-blur-sm">
              <Sparkles className="h-3 w-3 text-[var(--academic-brown)]" />
              <span>{m.paper_whiteboard()}</span>
            </div>
          </div>
        </div>

        {/* Paper Info */}
        <div className="p-4">
          <h3 className="mb-2 font-serif text-base font-semibold text-[var(--ink)] line-clamp-2 group-hover:text-[var(--academic-brown)] transition-colors">
            {paper.title}
          </h3>
          <div className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)]">
            <Globe className="h-3 w-3" />
            <time>{timeAgo}</time>
          </div>
        </div>
      </article>
    </Link>
  );
}

function GalleryCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] shadow-[0_4px_16px_rgba(45,42,36,0.08)]">
      <Skeleton className="aspect-[4/3] w-full" />
      <div className="p-4">
        <Skeleton className="mb-2 h-5 w-full" />
        <Skeleton className="h-4 w-20" />
      </div>
    </div>
  );
}

function EmptyGallery() {
  return (
    <div className="rise-in mx-auto max-w-md py-16 text-center">
      <div className="mb-6 flex justify-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--academic-brown),var(--gold))] shadow-[0_8px_24px_rgba(139,111,71,0.24)]">
          <Globe className="h-12 w-12 text-white" />
        </div>
      </div>
      <h2 className="mb-3 font-serif text-2xl font-bold text-[var(--ink)]">
        {m.explore_empty_title()}
      </h2>
      <p className="mb-6 text-base text-[var(--ink-soft)]">
        {m.explore_empty_description()}
      </p>
      <Link
        to="/papers"
        className="inline-flex items-center gap-2 rounded-xl bg-[var(--academic-brown)] px-6 py-3 text-sm font-semibold !text-white shadow-[0_4px_12px_rgba(139,111,71,0.24)] transition-all hover:-translate-y-1 hover:shadow-[0_6px_16px_rgba(139,111,71,0.32)] no-underline"
      >
        <Sparkles className="h-4 w-4" />
        {m.papers_upload()}
      </Link>
    </div>
  );
}

function getTimeAgo(date: Date | null): string {
  if (!date) return "";

  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return m.time_today();
  if (diffDays === 1) return m.time_days_ago({ days: "1" });
  if (diffDays < 7) return m.time_days_ago({ days: diffDays.toString() });
  if (diffDays < 30)
    return m.time_weeks_ago({ weeks: Math.floor(diffDays / 7).toString() });
  if (diffDays < 365)
    return m.time_months_ago({ months: Math.floor(diffDays / 30).toString() });
  return m.time_years_ago({ years: Math.floor(diffDays / 365).toString() });
}
