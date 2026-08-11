import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { PaperEmptyState } from "#/components/papers/paper-empty-state";
import { PaperRow, PaperRowSkeleton } from "#/components/papers/paper-row";
import { RecentPapers } from "#/components/papers/recent-papers";
import { UploadDialog } from "#/components/papers/upload-dialog";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { usePaperSSE } from "#/hooks/use-paper-sse";
import { useRequireAuth } from "#/hooks/use-require-auth";
import { useTRPC } from "#/integrations/trpc/react";
import { parseCsvParam } from "#/lib/gallery-search";
import { normalizeCategorySlugs } from "#/lib/paper-categories";
import { groupPapersByMonth } from "#/lib/papers-group";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

const papersSearchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(["processing", "failed"]).optional().catch(undefined),
  cat: z.string().optional().catch(undefined),
  tag: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/papers/")({
  validateSearch: papersSearchSchema,
  component: PapersPage,
  head: () => ({ meta: [{ title: m.page_title_papers() }] }),
});

const PAGE_SIZE = 50;
const paperSkeletonKeys = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];

function PapersPage() {
  const trpc = useTRPC();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const locale = getLocale();

  const q = search.q?.trim() || undefined;
  const status = search.status;
  const categories = normalizeCategorySlugs(parseCsvParam(search.cat));
  const tags = parseCsvParam(search.tag);
  const hasFilters = Boolean(categories.length || tags.length || status);

  const [inputValue, setInputValue] = useState(search.q ?? "");

  const { session, isSessionPending } = useRequireAuth("/papers");
  const profile = useQuery(trpc.user.getProfile.queryOptions());
  usePaperSSE(profile.data?.id);
  const queryClient = useQueryClient();

  // 前进后退时同步回输入框。回填只在 trim 后不同才覆盖 —— 无条件覆盖会吃掉
  // 用户正在输入的尾部空格("gpt " + "5" → "gpt5")。
  useEffect(() => {
    const next = search.q ?? "";
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

  // 用 trpc.paper.list.infiniteQueryOptions 是为了类型安全,并与 news.list 的
  // 写法保持一致(而不是像 gallery 那样手写 queryKey)。
  // 但这个 key 本身带 type:"infinite",与 queryKey() 产出的 type:"query"
  // 不构成前缀关系——react-query 的 partialMatchKey 会在这一层就判负。
  // 所以 use-paper-sse / share-banner / 删除论文 / 助手「加入库」那几处
  // invalidate 必须用 trpc.paper.list.pathKey()(或 pathFilter()),
  // 不能用 queryKey():用了会静默失配、列表处理完不刷新，且没有任何报错。
  const papersQuery = useInfiniteQuery({
    ...trpc.paper.list.infiniteQueryOptions(
      { limit: PAGE_SIZE, status, search: q, locale, categories, tags },
      { getNextPageParam: (last) => last.nextCursor },
    ),
    placeholderData: keepPreviousData,
  });

  const counts = useQuery(trpc.paper.statusCounts.queryOptions());

  const papers = useMemo(() => {
    const seen = new Set<string>();
    // 翻页期间新论文插到头部会让同一条跨页出现两次，保留首次出现
    return (papersQuery.data?.pages.flatMap((p) => p.papers) ?? []).filter(
      (p) => !seen.has(p.id) && seen.add(p.id),
    );
  }, [papersQuery.data]);

  const total = papersQuery.data?.pages[0]?.total ?? 0;

  // 搜索/筛选激活时关闭分组：把命中结果塞进月份标题没有意义
  const flatList = Boolean(q || hasFilters);
  const groups = useMemo(
    () => (flatList ? [] : groupPapersByMonth(papers)),
    [flatList, papers],
  );
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }),
    [locale],
  );

  const patchSearch = (patch: Record<string, string | undefined>) => {
    navigate({ search: (prev) => ({ ...prev, ...patch }) });
  };

  const toggleStatus = (next: "processing" | "failed") => {
    patchSearch({ status: status === next ? undefined : next });
  };

  const addTag = (tag: string) => {
    patchSearch({
      tag: Array.from(new Set([...tags, tag])).join(",") || undefined,
    });
  };

  // 上传会新建一篇 pending 论文 —— pending 算在途,所以「处理中」chip 的计数
  // 也要刷新,只 refetch 列表的话 chip 要等 60s staleTime 过了才出现。
  const handleUploadSuccess = () => {
    papersQuery.refetch();
    queryClient.invalidateQueries({
      queryKey: trpc.paper.statusCounts.queryKey(),
    });
  };

  // 无限滚动：哨兵进入视口（提前 800px 预取）时自动加载下一页。
  // 用回调 ref 而非 useRef + effect deps 不含 DOM 节点：session 请求与列表
  // 请求会竞速，若列表先返回，hasNextPage 在哨兵尚未挂载(仍在骨架屏)时就已
  // 翻真，此时 effect 若只依赖 hasNextPage 等值型 deps 便会永久错过挂载时机
  // (fetchNextPage 是稳定引用，之后也不会再触发)。回调 ref 让节点挂载本身
  // 成为触发点。
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = papersQuery;
  useEffect(() => {
    if (!sentinel || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isSessionPending) {
    return (
      <main className="page-wrap py-8">
        <div className="h-8 w-32 animate-pulse bg-neutral-100 dark:bg-neutral-800" />
        <div className="mt-6">
          {paperSkeletonKeys.map((key) => (
            <PaperRowSkeleton key={key} />
          ))}
        </div>
      </main>
    );
  }
  if (!session) return null;

  const emptyKind = q ? "search" : hasFilters ? "filter" : "library";

  return (
    <main className="page-wrap py-8">
      <div className="stagger-in">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-2xl font-bold text-[var(--ink)]">
            {m.papers_title()}
            {total > 0 && (
              <span
                className={`ml-2 text-sm font-normal text-[var(--ink-soft)] transition-opacity ${
                  papersQuery.isPlaceholderData ? "opacity-60" : ""
                }`}
              >
                · {total}
              </span>
            )}
          </h1>
          <UploadDialog
            credits={profile.data?.credits ?? 0}
            onSuccess={handleUploadSuccess}
          />
        </div>

        {/* 工具栏：搜索 + 状态 chip。没有「全部」chip —— 不筛选就是全部；
            处理中/失败只在计数 > 0 时出现，永远显示 0 的 tab 是纯噪音。 */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-soft)]" />
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={m.papers_search_placeholder()}
              aria-label={m.papers_search_placeholder()}
              maxLength={100}
              className="pl-9 pr-9"
            />
            {inputValue && (
              <button
                type="button"
                onClick={() => setInputValue("")}
                aria-label={m.papers_clear_search()}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {/* count===0 时仍保留已激活的 chip：否则最后一篇处理中论文完成的瞬间，
              chip 随 statusCounts 归零而卸载，但 URL 仍带着 ?status=processing，
              留下一个打不开、也清不掉筛选的空列表。 */}
          {((counts.data?.processing ?? 0) > 0 || status === "processing") && (
            <button
              type="button"
              onClick={() => toggleStatus("processing")}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                status === "processing"
                  ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--academic-brown-deep)]"
                  : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--gold)]"
              }`}
            >
              {m.papers_filter_processing()}
              {(counts.data?.processing ?? 0) > 0 &&
                ` ${counts.data?.processing}`}
            </button>
          )}
          {((counts.data?.failed ?? 0) > 0 || status === "failed") && (
            <button
              type="button"
              onClick={() => toggleStatus("failed")}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                status === "failed"
                  ? "border-[var(--sienna)] bg-[var(--sienna)]/12 text-[var(--sienna)]"
                  : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--sienna)]"
              }`}
            >
              {m.papers_filter_failed()}
              {(counts.data?.failed ?? 0) > 0 && ` ${counts.data?.failed}`}
            </button>
          )}
        </div>

        {/* Task 6 会在这里插入主题筛选 Popover 与已选筛选行 */}

        <RecentPapers />

        <div
          className={`mt-5 transition-opacity ${
            papersQuery.isPlaceholderData ? "opacity-60" : ""
          }`}
        >
          {papersQuery.isLoading ? (
            paperSkeletonKeys.map((key) => <PaperRowSkeleton key={key} />)
          ) : papersQuery.isError && papers.length === 0 ? (
            // 只在首屏失败时替换列表；后台重取失败时 react-query v5 会保留
            // data,此时不能把已加载的行换掉，否则一次 SSE 触发的后台重取
            // 失败就会把已加载的几百行全部换成一张错误卡。
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertTriangle className="size-8 text-[var(--sienna)]" />
              <p className="text-sm text-[var(--ink-soft)]">
                {m.papers_load_error()}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => papersQuery.refetch()}
              >
                {m.papers_retry()}
              </Button>
            </div>
          ) : papers.length === 0 ? (
            <PaperEmptyState kind={emptyKind} />
          ) : flatList ? (
            <div className="[&>article:last-child]:border-b-0">
              {papers.map((paper) => (
                <PaperRow key={paper.id} paper={paper} onTagClick={addTag} />
              ))}
            </div>
          ) : (
            groups.map((group) => (
              <section
                key={group.monthKey}
                className="mt-6 first:mt-0 [&>article:last-of-type]:border-b-0"
              >
                <h2 className="flex items-center gap-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--academic-brown)] after:h-px after:flex-1 after:bg-[var(--line)] after:content-['']">
                  {monthFormat.format(group.date)}
                </h2>
                {group.papers.map((paper) => (
                  <PaperRow key={paper.id} paper={paper} onTagClick={addTag} />
                ))}
              </section>
            ))
          )}
        </div>

        {/* 哨兵：滚动接近时自动加载；按钮作为无障碍 / 兜底入口。
            无内容可显示时(既没有下一页也没有已加载论文)不留 mt-8 空白——
            ref 始终挂着，一旦 hasNextPage 变真，effect 会立刻重新观察。 */}
        <div
          ref={setSentinel}
          className={
            hasNextPage || papers.length > 0 ? "mt-8 flex justify-center" : ""
          }
        >
          {hasNextPage ? (
            isFetchingNextPage ? (
              <div className="flex items-center gap-2 text-sm text-[var(--ink-soft)]">
                <Loader2 className="size-4 animate-spin" />
                {m.papers_loading()}
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchNextPage()}
              >
                {m.papers_load_more()}
              </Button>
            )
          ) : papers.length > 0 ? (
            <span className="text-xs text-[var(--ink-soft)]">
              {m.papers_no_more()}
            </span>
          ) : null}
        </div>
      </div>
    </main>
  );
}
