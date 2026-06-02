import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Globe, Search, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  GalleryCard,
  GalleryCardSkeleton,
  getCategoryLabel,
} from "#/components/papers/gallery-card";
import { Button } from "#/components/ui/button";
import { useTRPC } from "#/integrations/trpc/react";
import { parseCsvParam, parseSort } from "#/lib/gallery-search";
import {
  normalizeCategorySlugs,
  PAPER_CATEGORY_SLUGS,
} from "#/lib/paper-categories";
import { SITE_URL } from "#/lib/site-url";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

const gallerySearchSchema = z.object({
  q: z.string().optional(),
  cat: z.string().optional(),
  tag: z.string().optional(),
  sort: z.enum(["recent", "popular"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const Route = createFileRoute("/gallery/")({
  validateSearch: gallerySearchSchema,
  component: ExplorePage,
  head: ({ search }) => {
    const filtered = Boolean(
      search.q || search.cat || search.tag || search.sort || search.page,
    );
    const description =
      "Browse visual whiteboard summaries of today's top HuggingFace research papers, automatically updated daily.";
    const meta: Array<
      | { title: string }
      | { name: string; content: string }
      | { property: string; content: string }
    > = [
      { title: m.page_title_gallery() },
      { name: "description", content: description },
    ];
    if (filtered) {
      meta.push({ name: "robots", content: "noindex,follow" });
    }
    meta.push(
      { property: "og:title", content: m.page_title_gallery() },
      { property: "og:description", content: description },
      { property: "og:url", content: `${SITE_URL}/gallery` },
    );
    return {
      meta,
      ...(filtered
        ? { links: [{ rel: "canonical", href: `${SITE_URL}/gallery` }] }
        : {}),
    };
  },
});

// 每页论文数量。横向宽卡为 2 列, 8 篇正好 4 行, 一屏更聚焦。
const PAGE_SIZE = 8;

const gallerySkeletonKeys = Array.from(
  { length: PAGE_SIZE },
  (_, i) => `gallery-skeleton-${i + 1}`,
);

function ExplorePage() {
  const trpc = useTRPC();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const page = search.page ?? 1;
  const categories = normalizeCategorySlugs(parseCsvParam(search.cat));
  const tags = parseCsvParam(search.tag);
  const sort = parseSort(search.sort);
  const q = search.q?.trim() || undefined;

  // Local controlled input — debounced before writing to URL
  const [inputValue, setInputValue] = useState(search.q ?? "");

  // Keep local input in sync if URL q changes externally (e.g. browser back/forward)
  useEffect(() => {
    setInputValue(search.q ?? "");
  }, [search.q]);

  // Debounce search input → URL
  const urlQ = search.q?.trim() ?? "";
  useEffect(() => {
    const trimmed = inputValue.trim();
    if (trimmed === urlQ) return;
    const timer = setTimeout(() => {
      navigate({
        search: (prev) => ({
          ...prev,
          q: trimmed || undefined,
          page: undefined,
        }),
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue, urlQ, navigate]);

  const galleryQuery = useQuery(
    trpc.paper.listPublic.queryOptions({
      page: 1,
      limit: page * PAGE_SIZE,
      locale: getLocale(),
      q,
      categories,
      tags,
      sort,
    }),
  );

  const total = galleryQuery.data?.total ?? 0;
  const hasMore = page * PAGE_SIZE < total;
  const hasFilters = Boolean(q || categories.length || tags.length);

  // --- URL mutation helpers ---
  const patchSearch = (patch: Partial<z.infer<typeof gallerySearchSchema>>) =>
    navigate({
      search: (prev) => ({ ...prev, ...patch, page: undefined }),
    });

  const toggleCategory = (slug: string) => {
    const next = categories.includes(slug as (typeof categories)[number])
      ? categories.filter((c) => c !== slug)
      : [...categories, slug];
    patchSearch({ cat: next.length ? next.join(",") : undefined });
  };

  const addTag = (t: string) =>
    patchSearch({
      tag: Array.from(new Set([...tags, t])).join(",") || undefined,
    });

  const removeTag = (t: string) =>
    patchSearch({
      tag: tags.filter((x) => x !== t).join(",") || undefined,
    });

  const clearFilters = () => navigate({ search: () => ({}) });

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

        {/* Sticky filter bar */}
        <div className="sticky top-0 z-10 -mx-4 mb-6 bg-[var(--bg)]/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          {/* Row 1: search + sort */}
          <div className="flex items-center gap-3">
            {/* Search input */}
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-soft)] pointer-events-none" />
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={m.gallery_search_placeholder()}
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] py-2 pl-9 pr-9 text-sm text-[var(--ink)] placeholder:text-[var(--ink-soft)] outline-none transition-colors focus:border-[var(--academic-brown)] focus:ring-1 focus:ring-[var(--academic-brown)]/20"
              />
              {inputValue && (
                <button
                  type="button"
                  onClick={() => setInputValue("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink-soft)] hover:text-[var(--ink)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Sort toggle */}
            <div className="flex shrink-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] text-xs font-medium">
              <button
                type="button"
                onClick={() => patchSearch({ sort: undefined })}
                className={`px-3 py-2 transition-colors ${
                  sort === "recent"
                    ? "bg-[var(--academic-brown)] text-white"
                    : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                }`}
              >
                {m.gallery_sort_recent()}
              </button>
              <button
                type="button"
                onClick={() => patchSearch({ sort: "popular" })}
                className={`border-l border-[var(--line)] px-3 py-2 transition-colors ${
                  sort === "popular"
                    ? "bg-[var(--academic-brown)] text-white"
                    : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                }`}
              >
                {m.gallery_sort_popular()}
              </button>
            </div>
          </div>

          {/* Row 2: category chips */}
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {/* All chip */}
            <button
              type="button"
              onClick={() => patchSearch({ cat: undefined })}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                categories.length === 0
                  ? "border-[var(--academic-brown)] bg-[var(--academic-brown)] text-white"
                  : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--academic-brown)] hover:text-[var(--academic-brown)]"
              }`}
            >
              {m.gallery_all_categories()}
            </button>

            {PAPER_CATEGORY_SLUGS.map((slug) => {
              const label = getCategoryLabel(slug);
              const isActive = categories.includes(slug);
              return (
                <button
                  key={slug}
                  type="button"
                  onClick={() => toggleCategory(slug)}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? "border-[var(--academic-brown)] bg-[var(--academic-brown)] text-white"
                      : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--academic-brown)] hover:text-[var(--academic-brown)]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active filters row */}
        {hasFilters && (
          <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[var(--ink-soft)]">
              {m.gallery_filtered_label()}
            </span>

            {/* Selected categories */}
            {categories.map((slug) => {
              const label = getCategoryLabel(slug);
              return (
                <span
                  key={`cat-${slug}`}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--academic-brown)]/30 bg-[var(--academic-brown)]/8 px-2.5 py-0.5 text-xs text-[var(--academic-brown)]"
                >
                  {label}
                  <button
                    type="button"
                    onClick={() => toggleCategory(slug)}
                    className="ml-0.5 hover:opacity-70"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}

            {/* Selected tags */}
            {tags.map((tag) => (
              <span
                key={`tag-${tag}`}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-2.5 py-0.5 text-xs text-[var(--ink)]"
              >
                #{tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="ml-0.5 hover:opacity-70"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}

            <span className="text-[var(--ink-soft)]">
              {m.gallery_result_count({ count: String(total) })}
            </span>

            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto text-xs text-[var(--ink-soft)] underline underline-offset-2 hover:text-[var(--academic-brown)]"
            >
              {m.gallery_clear_filters()}
            </button>
          </div>
        )}

        {/* Gallery Grid */}
        {galleryQuery.isLoading ? (
          <div className="grid auto-rows-fr gap-5 lg:grid-cols-2">
            {gallerySkeletonKeys.map((skeletonKey) => (
              <GalleryCardSkeleton key={skeletonKey} />
            ))}
          </div>
        ) : total === 0 && hasFilters ? (
          <NoResults onClear={clearFilters} />
        ) : total === 0 ? (
          <EmptyGallery />
        ) : (
          <div className="grid auto-rows-fr gap-5 lg:grid-cols-2">
            {galleryQuery.data?.papers.map((paper, index) => (
              <GalleryCard
                key={paper.id}
                paper={paper}
                delay={`${index * 50}ms`}
                onTagClick={addTag}
              />
            ))}
          </div>
        )}

        {/* Load more */}
        {hasMore && (
          <div className="mt-10 flex justify-center">
            <Button
              variant="outline"
              disabled={galleryQuery.isFetching}
              onClick={() =>
                navigate({ search: (prev) => ({ ...prev, page: page + 1 }) })
              }
            >
              {galleryQuery.isFetching
                ? m.gallery_loading()
                : m.gallery_load_more()}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}

function NoResults({ onClear }: { onClear: () => void }) {
  return (
    <div className="rise-in mx-auto max-w-md py-16 text-center">
      <div className="mb-6 flex justify-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-[var(--surface-strong)] border border-[var(--line)] shadow-[0_4px_16px_rgba(45,42,36,0.08)]">
          <Search className="h-10 w-10 text-[var(--ink-soft)]" />
        </div>
      </div>
      <p className="mb-6 text-base text-[var(--ink-soft)]">
        {m.gallery_no_results()}
      </p>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-6 py-3 text-sm font-semibold text-[var(--ink)] shadow-[0_2px_8px_rgba(45,42,36,0.06)] transition-all hover:-translate-y-0.5 hover:border-[var(--academic-brown)] hover:text-[var(--academic-brown)]"
      >
        <X className="h-4 w-4" />
        {m.gallery_clear_filters()}
      </button>
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
