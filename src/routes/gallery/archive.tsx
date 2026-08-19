import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Globe,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  GalleryCard,
  GalleryCardSkeleton,
  getCategoryLabel,
} from "#/components/papers/gallery-card";
import { Button } from "#/components/ui/button";
import { usePaperFeedback } from "#/hooks/use-paper-feedback";
import { useTRPC, useTRPCClient } from "#/integrations/trpc/react";
import {
  GALLERY_LIST_QUERY_KEY,
  parseCsvParam,
  parseSort,
} from "#/lib/gallery-search";
import {
  normalizeCategorySlugs,
  PAPER_CATEGORY_SLUGS,
} from "#/lib/paper-categories";
import { SITE_URL } from "#/lib/site-url";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

// 档案页自己的一份 schema(不复用 /gallery 的):两个页面的参数集从此不同
// (这里多一个 dir),分开写以后各改各的不必互相牵连。
const gallerySearchSchema = z.object({
  q: z.string().optional(),
  cat: z.string().optional(),
  tag: z.string().optional(),
  sort: z.enum(["recent", "popular"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  dir: z.string().optional(),
});

export const Route = createFileRoute("/gallery/archive")({
  validateSearch: gallerySearchSchema,
  component: ArchivePage,
  head: ({ match }) => {
    const search = match.search;
    const filtered = Boolean(
      search.q ||
        search.cat ||
        search.tag ||
        search.sort ||
        search.page ||
        search.dir,
    );
    const description =
      "Search every paper in the PicX archive: weekly direction picks and the HuggingFace daily backlog.";
    const meta: Array<
      | { title: string }
      | { name: string; content: string }
      | { property: string; content: string }
    > = [
      { title: m.page_title_archive() },
      { name: "description", content: description },
    ];
    if (filtered) {
      meta.push({ name: "robots", content: "noindex,follow" });
    }
    meta.push(
      { property: "og:title", content: m.page_title_archive() },
      { property: "og:description", content: description },
      { property: "og:url", content: `${SITE_URL}/gallery/archive` },
    );
    return {
      meta,
      ...(filtered
        ? {
            links: [{ rel: "canonical", href: `${SITE_URL}/gallery/archive` }],
          }
        : {}),
    };
  },
});

// 每页论文数量。横向宽卡为 2 列, 8 篇正好 4 行——档案页论文基数比落地页大得多
// (全站存量 936+ 篇), 但无限滚动是逐页累加而非分页跳转, 首屏大小不影响能看到多少,
// 只影响首次请求的往返大小, 8 篇维持与落地页一致的排版节奏即可, 不必为了「档案」
// 这个语境专门调大。
const PAGE_SIZE = 8;

const gallerySkeletonKeys = Array.from(
  { length: PAGE_SIZE },
  (_, i) => `gallery-skeleton-${i + 1}`,
);

// 四处 chips(方向全选/方向单项/分类全选/分类单项)共用的选中态样式,
// 收敛掉逐字重复的条件字符串。
const chipClass = (active: boolean) =>
  `shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
    active
      ? "border-[var(--academic-brown)] bg-[var(--academic-brown)] text-white"
      : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--academic-brown)] hover:text-[var(--academic-brown)]"
  }`;

// 筛选轴的小字标签样式:方向行(单选)与分类行(多选)标记与配色完全相同,
// 不加轴标签会让用户以为是同一组可叠加的标签, 结果点方向 chip 时把之前选的
// 另一个方向静默替换掉(单选语义), 却没有任何视觉线索预告这一点。
// 不用 uppercase/small-caps: CJK 下这两种强调手法不生效也不好看。
const axisLabelClass =
  "mb-1 block text-[0.7rem] font-medium tracking-wide text-[var(--ink-soft)]";

function ArchivePage() {
  const client = useTRPCClient();
  const trpc = useTRPC();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const page = search.page ?? 1;
  const categories = normalizeCategorySlugs(parseCsvParam(search.cat));
  const tags = parseCsvParam(search.tag);
  const sort = parseSort(search.sort);
  const q = search.q?.trim() || undefined;
  const dirSlug = search.dir;

  // Local controlled input — debounced before writing to URL
  const [inputValue, setInputValue] = useState(search.q ?? "");

  // Keep local input in sync if URL q changes externally (e.g. browser back/forward).
  // We write the trimmed value to the URL, so overwriting unconditionally would eat
  // a trailing space the user is still typing after ("gpt " + "5" → "gpt5").
  useEffect(() => {
    const next = search.q ?? "";
    setInputValue((cur) => (cur.trim() === next ? cur : next));
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

  const locale = getLocale();

  // 真增量加载: 每次只取 PAGE_SIZE 条 (offset 分页), 客户端累加。
  // limit 恒为 PAGE_SIZE, 不会撞后端 max(100) 上限, 可扩展到任意数量。
  const galleryQuery = useInfiniteQuery({
    queryKey: [
      GALLERY_LIST_QUERY_KEY,
      { q, categories, tags, sort, locale, dir: dirSlug },
    ],
    queryFn: ({ pageParam, signal }) =>
      client.paper.listPublic.query(
        {
          page: pageParam,
          limit: PAGE_SIZE,
          locale,
          q,
          categories,
          tags,
          sort,
          direction: dirSlug,
        },
        { signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) =>
      allPages.length * PAGE_SIZE < lastPage.total
        ? allPages.length + 1
        : undefined,
  });

  const papers = galleryQuery.data?.pages.flatMap((p) => p.papers) ?? [];
  const total = galleryQuery.data?.pages[0]?.total ?? 0;
  const hasMore = papers.length < total;
  const hasFilters = Boolean(q || categories.length || tags.length || dirSlug);

  // 卡片上要显示的是方向名而不是 slug, 而且这份数据本页还要拿来渲染方向筛选
  // chips 行。与 /gallery、方向页用的是同一个 query key, react-query 去重,
  // 不会多发一次请求。
  const directionsQuery = useQuery({
    ...trpc.digest.listDirections.queryOptions({ locale }),
    staleTime: 5 * 60_000,
  });
  const directionNameBySlug = new Map(
    (directionsQuery.data ?? []).map((d) => [d.slug, d.name] as const),
  );

  // 反馈按钮装配(登录态口径 / 登录回跳地址 / 「我的投票」分批取)三个页面共用,
  // 细节与陷阱都在 usePaperFeedback 里。
  const { feedbackAuth, signInCallbackURL, myVoteByPaperId } = usePaperFeedback(
    papers.map((p) => p.id),
  );

  // URL 的 page 表示"已展开到第几页": deep link / 刷新 / 点「加载更多」都通过它驱动,
  // 逐页补拉直到加载到目标页数 (单一数据源)。
  const loadedPages = galleryQuery.data?.pages.length ?? 0;
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = galleryQuery;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅在目标/已加载页数变化时补拉
  useEffect(() => {
    if (loadedPages < page && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [page, loadedPages, hasNextPage, isFetchingNextPage]);

  // 无限滚动: 哨兵元素进入视口时自动展开下一页 (仍走 URL 的 page 单一数据源)。
  // 防频繁触发: 仅当已加载页数追平目标页 (loadedPages >= page) 且不在加载中时才追加,
  // 每次追加都需等一次 fetch 往返, 天然节流。
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (
        entries[0]?.isIntersecting &&
        hasMore &&
        !isFetchingNextPage &&
        loadedPages >= page
      ) {
        navigate({
          search: (prev) => ({ ...prev, page: page + 1 }),
          resetScroll: false,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isFetchingNextPage, loadedPages, page, navigate]);

  // Category chips collapse to 2 rows; a toggle appears only when they overflow.
  const chipsRef = useRef<HTMLDivElement>(null);
  const [chipsExpanded, setChipsExpanded] = useState(false);
  // px height of the first two rows; null = chips already fit in ≤2 rows (no toggle).
  const [collapsedChipsH, setCollapsedChipsH] = useState<number | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on locale change — chip labels change width and (while clamped) the ResizeObserver won't fire on reflow.
  useEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    const measure = () => {
      const kids = Array.from(el.children) as HTMLElement[];
      if (kids.length === 0) return;
      // Distinct offsetTop values = rows (overflow-hidden doesn't move children,
      // so this stays correct even while clamped).
      const rowTops: number[] = [];
      for (const k of kids) {
        if (!rowTops.includes(k.offsetTop)) rowTops.push(k.offsetTop);
      }
      if (rowTops.length <= 2) {
        setCollapsedChipsH(null);
        return;
      }
      const secondRowTop = rowTops[1];
      const secondRowBottom = Math.max(
        ...kids
          .filter((k) => k.offsetTop === secondRowTop)
          .map((k) => k.offsetTop + k.offsetHeight),
      );
      setCollapsedChipsH(secondRowBottom - rowTops[0]);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [locale]);

  const chipsClamped = collapsedChipsH !== null && !chipsExpanded;

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
    <main className="min-h-dvh bg-[var(--bg)] py-8">
      <div className="page-wrap">
        {/* Header */}
        <div className="rise-in mb-8 text-center">
          <h1 className="mb-3 font-serif text-4xl font-bold text-[var(--ink)] sm:text-5xl">
            {m.archive_title()}
          </h1>
          <p className="text-lg text-[var(--ink-soft)]">
            {m.archive_description()}
          </p>
        </div>

        {/* Sticky filter bar */}
        {/* sticky 偏移 = --header-h(全局 Header 的实际高度, 定义在 styles.css)
            减 1px: 让接缝藏在 header 的下边框里, 避免滚动时露出一条缝。 */}
        <div className="sticky top-[calc(var(--header-h)_-_1px_+_env(safe-area-inset-top))] z-10 -mx-4 mb-6 px-4 py-3 sm:-mx-6 sm:px-6">
          {/* 玻璃底:独立层 + 底部羽化, 让卡片柔和淡入而非硬切的模糊边。
              延伸到 mb-6 间距下方, 羽化带落在卡片之外, 不影响搜索框/标签。 */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 -bottom-6 -z-10 bg-[var(--header-bg)] backdrop-blur-md mask-b-from-[calc(100%-1.5rem)] mask-b-to-100%"
          />
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

          {/* 方向筛选行: 单选(radiogroup)。分类是论文自带属性, 方向是「哪一期
              挑中过它」, 两者是不同维度, 所以分两行而不是混在同一组 chips 里——
              两行的标记/配色故意相同(都是圆角描边 chip), 靠上面的轴标签
              (「方向」/「分类」)区分「这行是二选一」还是「这行可叠加」,
              并用 radiogroup/radio + aria-checked 把单选语义讲给读屏听。 */}
          {(directionsQuery.data ?? []).length > 0 && (
            <div className="mt-3">
              <span className={axisLabelClass}>
                {m.archive_filter_axis_direction()}
              </span>
              <div
                role="radiogroup"
                aria-label={m.archive_filter_axis_direction()}
                className="flex flex-wrap gap-1.5"
              >
                {/* biome-ignore lint/a11y/useSemanticElements: 与页面其余 chips 共用
                    pill 视觉且支持点已选中项取消(回到「全部」)——原生 <input
                    type="radio"> 一组里选中项不能被自己取消, 语义不匹配, 只能
                    用 button + role="radio" 手写。 */}
                <button
                  type="button"
                  role="radio"
                  aria-checked={dirSlug === undefined}
                  onClick={() => patchSearch({ dir: undefined })}
                  className={chipClass(dirSlug === undefined)}
                >
                  {m.archive_all_directions()}
                </button>
                {(directionsQuery.data ?? []).map((d) => (
                  // biome-ignore lint/a11y/useSemanticElements: 同上, 一组里逐个标注太啰嗦
                  <button
                    key={d.slug}
                    type="button"
                    role="radio"
                    aria-checked={dirSlug === d.slug}
                    onClick={() =>
                      patchSearch({
                        dir: dirSlug === d.slug ? undefined : d.slug,
                      })
                    }
                    className={chipClass(dirSlug === d.slug)}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Row 2: category chips (collapse to 2 rows). 分类是可叠加多选,
              选中态目前跟全站其他 chips/排序开关一样只靠颜色表达(既有的全站
              一致性问题, 留给另一轮统一处理), 这里不单独改。 */}
          <div className="mt-3">
            <span className={axisLabelClass}>
              {m.archive_filter_axis_category()}
            </span>
            <div
              ref={chipsRef}
              className={`flex flex-wrap gap-1.5${chipsClamped ? " overflow-hidden" : ""}`}
              style={
                chipsClamped
                  ? { maxHeight: collapsedChipsH ?? undefined }
                  : undefined
              }
            >
              {/* All chip */}
              <button
                type="button"
                onClick={() => patchSearch({ cat: undefined })}
                className={chipClass(categories.length === 0)}
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
                    className={chipClass(isActive)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {collapsedChipsH !== null && (
              <button
                type="button"
                onClick={() => setChipsExpanded((v) => !v)}
                className="mt-2 text-xs font-medium text-[var(--academic-brown)] transition-opacity hover:opacity-70"
              >
                {chipsExpanded ? m.gallery_show_less() : m.gallery_show_more()}
              </button>
            )}
          </div>
        </div>

        {/* Active filters row */}
        {hasFilters && (
          <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[var(--ink-soft)]">
              {m.gallery_filtered_label()}
            </span>

            {/* Selected direction — separate dimension from category, so its own chip */}
            {dirSlug && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--academic-brown)]/30 bg-[var(--academic-brown)]/8 px-2.5 py-0.5 text-xs text-[var(--academic-brown)]">
                {directionNameBySlug.get(dirSlug) ?? dirSlug}
                <button
                  type="button"
                  onClick={() => patchSearch({ dir: undefined })}
                  className="ml-0.5 hover:opacity-70"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

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

        {/* Gallery Grid

            isError 必须排在两个空态之前: 取数失败时 isLoading 已是 false、data 是
            undefined 于是 total 为 0, 不拦就会直接落进 EmptyGallery / NoResults ——
            前者请用户「来上传第一篇」, 后者请用户清筛选, 两句在一次网络抖动面前都是
            错的, 而且都把「重试」这个唯一有用的动作藏了起来。方向页的论文流已经是
            这个口径(见那边注释: 把失败说成空态等于对用户撒谎), 这里补齐。 */}
        {galleryQuery.isLoading ? (
          <div className="grid auto-rows-fr gap-5 lg:grid-cols-2">
            {gallerySkeletonKeys.map((skeletonKey) => (
              <GalleryCardSkeleton key={skeletonKey} />
            ))}
          </div>
        ) : galleryQuery.isError ? (
          <LoadFailedGallery onRetry={() => galleryQuery.refetch()} />
        ) : total === 0 && hasFilters ? (
          <NoResults onClear={clearFilters} />
        ) : total === 0 ? (
          <EmptyGallery />
        ) : (
          <div className="grid auto-rows-fr gap-5 lg:grid-cols-2">
            {papers.map((paper, index) => (
              <GalleryCard
                key={paper.id}
                paper={paper}
                delay={`${index * 50}ms`}
                onTagClick={addTag}
                directionLabel={
                  paper.directionSlug
                    ? directionNameBySlug.get(paper.directionSlug)
                    : undefined
                }
                myVote={myVoteByPaperId.get(paper.id)}
                feedbackAuth={feedbackAuth}
                signInCallbackURL={signInCallbackURL}
              />
            ))}
          </div>
        )}

        {/* Upload CTA — invite browsers to turn their own paper into a whiteboard */}
        {papers.length > 0 && (
          <section className="rise-in mt-16">
            <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[linear-gradient(135deg,var(--parchment-warm),var(--surface-strong))] px-6 py-8 text-center shadow-[0_4px_16px_rgba(45,42,36,0.06)] sm:px-10 sm:py-10">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--academic-brown),var(--gold))] shadow-[0_6px_18px_rgba(139,111,71,0.28)]">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
              <h2 className="mb-2 font-serif text-2xl font-bold text-[var(--ink)]">
                {m.gallery_cta_title()}
              </h2>
              <p className="mx-auto mb-6 max-w-md text-[var(--ink-soft)]">
                {m.gallery_cta_desc()}
              </p>
              <Link
                to="/papers"
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--academic-brown)] px-6 py-3 text-sm font-semibold !text-white no-underline shadow-[0_4px_12px_rgba(139,111,71,0.24)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(139,111,71,0.32)]"
              >
                <Sparkles className="h-4 w-4" />
                {m.papers_upload()}
              </Link>
            </div>
          </section>
        )}

        {/* Load more — 滚动到哨兵元素时自动加载; 按钮作为无障碍 / 兜底入口 */}
        {hasMore && (
          <div ref={loadMoreRef} className="mt-10 flex justify-center">
            {isFetchingNextPage ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="size-4 animate-spin" />
                {m.gallery_loading()}
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() =>
                  navigate({
                    search: (prev) => ({ ...prev, page: page + 1 }),
                    resetScroll: false,
                  })
                }
              >
                {m.gallery_load_more()}
              </Button>
            )}
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

/**
 * 论文流的加载失败态。与两个空态刻意长得不一样:
 * - 骨架 = 还在加载
 * - 空态(EmptyGallery / NoResults): 无边框、暖色/渐变图标块 = 这里本来就没内容
 * - 本组件: 实线边框面板 + 警告图标 = 内容应该在, 只是这次没取到
 * 这与方向页简报大卡「虚线 = 内容在路上, 实线 = 这次没取到」是同一套区分。
 * 重试按钮直接 refetch, 不用刷整页 —— 失败多半是一次抖动。
 */
function LoadFailedGallery({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rise-in mx-auto max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-6 py-12 text-center shadow-[0_4px_16px_rgba(45,42,36,0.06)]">
      <div className="mb-5 flex justify-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--parchment-warm)]">
          <AlertTriangle className="h-7 w-7 text-[var(--academic-brown)]" />
        </div>
      </div>
      <p className="mb-6 text-base text-[var(--ink-soft)]">
        {m.gallery_load_failed()}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-6 py-3 text-sm font-semibold text-[var(--ink)] shadow-[0_2px_8px_rgba(45,42,36,0.06)] transition-all hover:-translate-y-0.5 hover:border-[var(--academic-brown)] hover:text-[var(--academic-brown)]"
      >
        <RotateCcw className="h-4 w-4" />
        {m.gallery_retry()}
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
