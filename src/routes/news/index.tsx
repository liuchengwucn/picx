import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Newspaper } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";
import {
  FeaturedStory,
  SubFeaturedStory,
} from "#/components/news/featured-story";
import { StoryRow, StoryRowSkeleton } from "#/components/news/story-row";
import { Button } from "#/components/ui/button";
import { useTRPC } from "#/integrations/trpc/react";
import { dateKeyOf, groupStoriesByDay } from "#/lib/news/group-stories";
import { useDebugScores } from "#/lib/news/use-debug-scores";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

const newsSearchSchema = z.object({
  sort: z.enum(["latest", "active"]).optional(),
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
const newsSkeletonKeys = ["s1", "s2", "s3", "s4", "s5", "s6"];

function NewsPage() {
  const trpc = useTRPC();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const showScores = useDebugScores();
  const locale = getLocale();
  const sort = search.sort ?? "latest";

  const newsQuery = useInfiniteQuery({
    ...trpc.news.list.infiniteQueryOptions(
      { limit: PAGE_SIZE, sort, locale },
      { getNextPageParam: (last) => last.nextCursor },
    ),
    // 排序切换换 key 期间沿用旧数据，由下方 isPlaceholderData 降透明度提示
    placeholderData: keepPreviousData,
    // infinite query 的 refetch 按页串行；不设 staleTime 的话，用户翻了几页后
    // 离开再回来会串行重取全部已加载页。feed 由每小时 cron 喂，分钟级陈旧无害。
    staleTime: 300_000,
  });

  const stories = useMemo(() => {
    const seen = new Set<string>();
    // 游标翻页间 story 排序键可能漂移（并入更早成员），跨页重复时保留首次出现
    return (newsQuery.data?.pages.flatMap((p) => p.stories) ?? []).filter(
      (s) => !seen.has(s.shortId) && seen.add(s.shortId),
    );
  }, [newsQuery.data]);
  // 分组/头条在累积后的完整列表上计算：日期头不重复，
  // 仅最底部未加载完的那天的头条会随下一批加载自我修正（视口外，可接受）
  const groups = useMemo(
    () => (sort === "latest" ? groupStoriesByDay(stories) : []),
    [sort, stories],
  );
  const todayKey = dateKeyOf(new Date());
  const yesterdayKey = dateKeyOf(new Date(Date.now() - 86_400_000));
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" }),
    [locale],
  );
  const dayLabel = (dateKey: string, date: Date) => {
    const formatted = dateFormat.format(date);
    if (dateKey === todayKey) return `${m.news_today()} · ${formatted}`;
    if (dateKey === yesterdayKey) return `${m.news_yesterday()} · ${formatted}`;
    return formatted;
  };

  const setSort = (next: "latest" | "active") => {
    navigate({ search: { sort: next === "latest" ? undefined : next } });
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

        <div
          className={`rise-in mt-4 transition-opacity ${
            newsQuery.isPlaceholderData ? "opacity-60" : ""
          }`}
        >
          {newsQuery.isLoading ? (
            newsSkeletonKeys.map((key) => <StoryRowSkeleton key={key} />)
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
          ) : sort === "latest" ? (
            groups.map((group, groupIndex) => (
              // 日期标题线是天与天之间唯一的分界：每天最后一排 story 去掉自身底线，
              // 避免与下一天标题线双线冗余（无 rest 时最后一个 article 即头条/次头条）
              <section
                key={group.dateKey}
                className={`mt-8 first:mt-2 ${
                  group.rest.length === 0
                    ? "[&>article:last-of-type]:border-b-0"
                    : ""
                }`}
              >
                <h2 className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--academic-brown)] after:h-px after:flex-1 after:bg-[var(--line)] after:content-['']">
                  {dayLabel(group.dateKey, group.date)}
                </h2>
                <FeaturedStory
                  story={group.featured}
                  showScores={showScores}
                  eager={groupIndex === 0}
                />
                {group.subFeatured.map((story) => (
                  <SubFeaturedStory
                    key={story.shortId}
                    story={story}
                    showScores={showScores}
                  />
                ))}
                {group.rest.length > 0 && (
                  // 双栏时末排可能是 1 或 2 个：偶数条时倒数第二个仅在 sm 起同排，才一并去线
                  <div
                    className={`grid grid-cols-1 gap-x-10 sm:grid-cols-2 [&>article:last-child]:border-b-0 ${
                      group.rest.length % 2 === 0
                        ? "sm:[&>article:nth-last-child(2)]:border-b-0"
                        : ""
                    }`}
                  >
                    {group.rest.map((story) => (
                      <StoryRow
                        key={story.shortId}
                        story={story}
                        showScores={showScores}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))
          ) : (
            <div className="[&>article:last-child]:border-b-0">
              {stories.map((story) => (
                <StoryRow
                  key={story.shortId}
                  story={story}
                  showScores={showScores}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-8 flex justify-center">
          {newsQuery.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              disabled={newsQuery.isFetchingNextPage}
              onClick={() => newsQuery.fetchNextPage()}
            >
              {m.news_load_more()}
            </Button>
          ) : stories.length > 0 ? (
            <span className="text-xs text-[var(--ink-soft)]">
              {m.news_no_more()}
            </span>
          ) : null}
        </div>
      </div>
    </main>
  );
}
