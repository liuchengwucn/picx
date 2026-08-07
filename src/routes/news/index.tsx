import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Calendar as CalendarIcon,
  Loader2,
  Newspaper,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { enUS, ja, zhCN, zhTW } from "react-day-picker/locale";
import { z } from "zod";
import {
  FeaturedStory,
  SubFeaturedStory,
} from "#/components/news/featured-story";
import { StoryRow, StoryRowSkeleton } from "#/components/news/story-row";
import { Button } from "#/components/ui/button";
import { Calendar } from "#/components/ui/calendar";
import { Input } from "#/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import { useTRPC } from "#/integrations/trpc/react";
import { beforeTsOf, dateFromKey } from "#/lib/news/date-jump";
import { dateKeyOf, groupStoriesByDay } from "#/lib/news/group-stories";
import { useDebugScores } from "#/lib/news/use-debug-scores";
import { SITE_URL } from "#/lib/site-url";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

const newsSearchSchema = z.object({
  sort: z.enum(["latest", "active"]).optional(),
  q: z.string().max(100).optional().catch(undefined),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute("/news/")({
  validateSearch: newsSearchSchema,
  component: NewsPage,
  head: ({ match }) => {
    const filtered = Boolean(match.search.q || match.search.date);
    return {
      meta: [
        { title: m.news_page_title() },
        { name: "description", content: m.news_page_desc() },
        ...(filtered ? [{ name: "robots", content: "noindex,follow" }] : []),
      ],
      ...(filtered
        ? { links: [{ rel: "canonical", href: `${SITE_URL}/news` }] }
        : {}),
    };
  },
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
  const q = search.q?.trim() || undefined;
  const [inputValue, setInputValue] = useState(search.q ?? "");
  // date 只在 latest 下有意义（active 按活跃时间排序，日期起点语义不成立）
  const dateParam = sort === "latest" ? search.date : undefined;
  const selectedDate = dateParam ? dateFromKey(dateParam) : null;
  const beforeTs = dateParam ? (beforeTsOf(dateParam) ?? undefined) : undefined;
  const [calOpen, setCalOpen] = useState(false);
  const dayPickerLocale =
    locale === "zh-CN"
      ? zhCN
      : locale === "zh-TW"
        ? zhTW
        : locale === "ja"
          ? ja
          : enUS;

  // 浏览器前进后退时同步回输入框
  useEffect(() => {
    const next = search.q ?? "";
    // 回填仅用于外部改动（前进后退）。我们写入 URL 的是 trim 后的值，
    // 无条件覆盖会吃掉用户正在输入的尾部空格。
    setInputValue((cur) => (cur.trim() === next ? cur : next));
  }, [search.q]);

  // 300ms debounce 后 replace 写 URL，避免每字符一条历史记录
  const urlQ = search.q?.trim() ?? "";
  useEffect(() => {
    const trimmed = inputValue.trim();
    if (trimmed === urlQ) return;
    const timer = setTimeout(() => {
      navigate({
        replace: true,
        search: (prev) => ({ ...prev, q: trimmed || undefined }),
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue, urlQ, navigate]);

  const newsQuery = useInfiniteQuery({
    ...trpc.news.list.infiniteQueryOptions(
      { limit: PAGE_SIZE, sort, locale, q, beforeTs },
      { getNextPageParam: (last) => last.nextCursor },
    ),
    // 搜索词 / 排序切换换 key 期间沿用旧数据，由下方 isPlaceholderData 降透明度提示
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
  // 搜索时禁用按天分组：把命中结果塞进日期头 + 头条结构没有意义
  const flatList = sort === "active" || Boolean(q);
  // 分组/头条在累积后的完整列表上计算：日期头不重复
  const groups = useMemo(
    () => (flatList ? [] : groupStoriesByDay(stories)),
    [flatList, stories],
  );
  // 还有下一页时最后一天可能未加载完，其头条/次头条会随下一批数据修正。
  // 无限滚动的触发点就在视口附近，重排会造成可见跳动，因此扣留该天
  // 不渲染，补完（出现新的天边界或加载到底）后再一次性放出。
  const visibleGroups = newsQuery.hasNextPage ? groups.slice(0, -1) : groups;
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
    navigate({
      search: (prev) => ({
        ...prev,
        sort: next === "latest" ? undefined : next,
        date: next === "active" ? undefined : prev.date,
      }),
    });
  };

  // 无限滚动：哨兵进入视口（提前 800px 预取）时自动加载下一页。
  // isFetchingNextPage 翻转会重建 observer，observe() 立即回调一次当前相交
  // 状态——某天跨多页被扣留时，哨兵滞留视口内即可连续补拉直到天边界出现。
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = newsQuery;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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

        {/* Toolbar: search + sort */}
        <div className="rise-in mt-6 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-soft)]" />
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={m.news_search_placeholder()}
              aria-label={m.news_search_placeholder()}
              maxLength={100}
              className="pl-9 pr-9"
            />
            {inputValue && (
              <button
                type="button"
                onClick={() => setInputValue("")}
                aria-label={m.news_clear_search()}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              {/* size=icon 与 Input / 排序按钮同为 h-9，同排控件基线一致 */}
              <Button
                variant={selectedDate ? "default" : "outline"}
                size="icon"
                aria-label={m.news_jump_to_date()}
              >
                <CalendarIcon className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={selectedDate ?? undefined}
                // 上月留白日全墨色、未来日置灰，两种数字一行之隔却语义相反；直接不渲染
                showOutsideDays={false}
                // v10 的 getInitialMonth 是 month || defaultMonth || today，不看
                // selected：不给 defaultMonth 则重开日历总跳回本月，翻月选历史日期后
                // 想改选相邻一天得重新翻回去
                defaultMonth={selectedDate ?? undefined}
                onSelect={(d) => {
                  setCalOpen(false);
                  if (!d) return;
                  const key = dateKeyOf(d);
                  navigate({
                    search: (prev) => ({
                      ...prev,
                      sort: undefined, // 选日期强制回 latest
                      date: key === todayKey ? undefined : key, // 选今天=回默认视图
                    }),
                  });
                  window.scrollTo({ top: 0 });
                }}
                disabled={{ after: new Date() }}
                // disabled 只置灰未来日期，不挡翻页；endMonth 才能停在本月
                endMonth={new Date()}
                locale={dayPickerLocale}
              />
            </PopoverContent>
          </Popover>
          <div className="flex items-center gap-2">
            <Button
              variant={sort === "latest" ? "default" : "outline"}
              onClick={() => setSort("latest")}
            >
              {m.news_sort_latest()}
            </Button>
            <Button
              variant={sort === "active" ? "default" : "outline"}
              onClick={() => setSort("active")}
            >
              {m.news_sort_active()}
            </Button>
          </div>
        </div>

        {dateParam && selectedDate && (
          <div className="rise-in mt-3">
            {/* 与 gallery 已选筛选项同一 chip 语汇：标签与 ✕ 同处一枚药丸内 */}
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--academic-brown)]/30 bg-[var(--academic-brown)]/8 px-2.5 py-0.5 text-xs text-[var(--academic-brown)]">
              {m.news_up_to_date({ date: dateFormat.format(selectedDate) })}
              <button
                type="button"
                aria-label={m.news_clear_date()}
                onClick={() =>
                  navigate({ search: (prev) => ({ ...prev, date: undefined }) })
                }
                className="ml-0.5 hover:opacity-70"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

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
                {/* 用 URL 上的 q 而非 inputValue：debounce 期间查询还没跑，文案不该提前翻转 */}
                {q || dateParam
                  ? m.news_no_results_title()
                  : m.news_empty_title()}
              </h2>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                {q || dateParam
                  ? m.news_no_results_desc()
                  : m.news_empty_desc()}
              </p>
            </div>
          ) : !flatList ? (
            visibleGroups.map((group, groupIndex) => (
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

        {/* 哨兵：滚动接近时自动加载；按钮作为无障碍 / 兜底入口 */}
        <div ref={loadMoreRef} className="mt-8 flex justify-center">
          {hasNextPage ? (
            isFetchingNextPage ? (
              <div className="flex items-center gap-2 text-sm text-[var(--ink-soft)]">
                <Loader2 className="size-4 animate-spin" />
                {m.news_loading()}
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchNextPage()}
              >
                {m.news_load_more()}
              </Button>
            )
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
