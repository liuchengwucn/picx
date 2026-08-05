import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Newspaper } from "lucide-react";
import { z } from "zod";
import { StoryCard, StoryCardSkeleton } from "#/components/news/story-card";
import { Button } from "#/components/ui/button";
import { useTRPC } from "#/integrations/trpc/react";
import { useDebugScores } from "#/lib/news/use-debug-scores";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

const newsSearchSchema = z.object({
  sort: z.enum(["latest", "active"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const Route = createFileRoute("/news/")({
  validateSearch: newsSearchSchema,
  component: NewsPage,
  head: () => ({
    meta: [
      { title: m.news_page_title() },
      { name: "description", content: m.news_page_desc() },
    ],
  }),
});

const PAGE_SIZE = 20;

const newsSkeletonKeys = [
  "news-skeleton-1",
  "news-skeleton-2",
  "news-skeleton-3",
  "news-skeleton-4",
  "news-skeleton-5",
  "news-skeleton-6",
];

function NewsPage() {
  const trpc = useTRPC();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const showScores = useDebugScores();

  const sort = search.sort ?? "latest";
  const page = search.page ?? 1;

  const newsQuery = useQuery({
    ...trpc.news.list.queryOptions({
      page,
      limit: PAGE_SIZE,
      sort,
      locale: getLocale(),
      debug: showScores,
    }),
    // debug 切换会换 query key（无缓存）；保留上一屏数据，避免闪回骨架屏。
    // 注意这也作用于翻页/切排序：加载中不再走骨架屏分支，改由下方 isPlaceholderData 降透明度提示
    placeholderData: keepPreviousData,
  });

  const totalPages = Math.ceil((newsQuery.data?.total ?? 0) / PAGE_SIZE);
  const stories = newsQuery.data?.stories ?? [];

  // 切排序回到第一页;默认值不写进 URL,保持地址干净
  const setSort = (next: "latest" | "active") => {
    navigate({
      search: {
        sort: next === "latest" ? undefined : next,
        page: undefined,
      },
    });
  };

  const setPage = (next: number) => {
    navigate({
      search: (prev) => ({
        ...prev,
        page: next <= 1 ? undefined : next,
      }),
    });
  };

  return (
    <main className="min-h-screen bg-[var(--bg)] py-8">
      <div className="page-wrap">
        <div className="rise-in">
          <h1 className="font-serif text-3xl font-bold text-[var(--ink)]">
            {m.news_heading()}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            {m.news_subheading()}
          </p>
        </div>

        {/* Sort toggle */}
        <div className="rise-in mt-6 flex items-center gap-2">
          <Button
            variant={sort === "latest" ? "default" : "outline"}
            size="sm"
            onClick={() => setSort("latest")}
          >
            {m.news_sort_latest()}
          </Button>
          <Button
            variant={sort === "active" ? "default" : "outline"}
            size="sm"
            onClick={() => setSort("active")}
          >
            {m.news_sort_active()}
          </Button>
        </div>

        {/* Story list：占位数据（翻页中）降透明度作为加载反馈 */}
        <div
          className={`stagger-in mt-6 space-y-4 transition-opacity ${
            newsQuery.isPlaceholderData ? "opacity-60" : ""
          }`}
        >
          {newsQuery.isLoading ? (
            newsSkeletonKeys.map((skeletonKey) => (
              <StoryCardSkeleton key={skeletonKey} />
            ))
          ) : stories.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-16 text-center">
              <Newspaper className="mx-auto h-8 w-8 text-[var(--ink-soft)] opacity-60" />
              <h2 className="mt-4 font-serif text-lg font-semibold text-[var(--ink)]">
                {m.news_empty_title()}
              </h2>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                {m.news_empty_desc()}
              </p>
            </div>
          ) : (
            stories.map((story, i) => (
              <StoryCard
                key={story.shortId}
                story={story}
                delay={`${i * 40}ms`}
                showScores={showScores}
              />
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-[var(--ink-soft)]">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
