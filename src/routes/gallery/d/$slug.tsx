import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  isNotFound,
  notFound,
  useRouterState,
} from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  DigestEmptyIssueCard,
  DigestIssueCard,
} from "#/components/digest/digest-issue-card";
import { DirectionTabs } from "#/components/digest/direction-tabs";
import { IssueList } from "#/components/digest/issue-list";
import type { FeedbackAuthState } from "#/components/papers/feedback-buttons";
import {
  GalleryCard,
  GalleryCardSkeleton,
} from "#/components/papers/gallery-card";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { useTRPC, useTRPCClient } from "#/integrations/trpc/react";
import { authClient } from "#/lib/auth-client";
import { GALLERY_LIST_QUERY_KEY } from "#/lib/gallery-search";
import {
  getReviewGuestClientSession,
  isReviewGuestModeEnabled,
  isReviewGuestReadOnlySession,
} from "#/lib/review-guest";
import { SITE_URL } from "#/lib/site-url";
import { normalizeLocaleKey, pickTldr } from "#/lib/tldr";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

interface AppEnvBindings {
  DB: D1Database;
}

export const Route = createFileRoute("/gallery/d/$slug")({
  component: DirectionPage,
  /**
   * 方向 slug 是动态数据, 没法像 /gallery/c/$slug 那样静态白名单校验, 只能查库。
   * 页面本身仍是客户端渲染, loader 只做两件小事: 校验 slug 存在, 并给 <title>
   * 一个方向名。简报/论文内容一概不在这里预取。
   */
  loader: async ({ context, params }) => {
    if (import.meta.env.SSR) {
      // 服务端不能用 queryClient.ensureQueryData: tRPC client 在 SSR 侧指向
      // localhost, 部署到 Workers 里发不出去。与 /p /news 详情页同一处理 —— 直读 D1。
      try {
        const { env } = await import("cloudflare:workers");
        const { drizzle } = await import("drizzle-orm/d1");
        const { and, eq } = await import("drizzle-orm");
        const { directions } = await import("#/db/schema");
        const db = drizzle((env as typeof env & AppEnvBindings).DB);
        const [row] = await db
          .select({ name: directions.name })
          .from(directions)
          .where(
            and(
              eq(directions.slug, params.slug),
              eq(directions.isActive, true),
            ),
          )
          .limit(1);
        // 查不到 → 真 404 状态码, 而不是 200 的空壳页
        if (!row) throw notFound();
        return {
          directionName: pickTldr(row.name, normalizeLocaleKey(getLocale())),
        };
      } catch (error) {
        // notFound 必须穿透; 其余错误(D1 不可用等)降级为纯 CSR
        if (isNotFound(error)) throw error;
        return { directionName: null };
      }
    }

    // 客户端导航: 复用 DirectionTabs / gallery 列表页那次 listDirections。
    // queryKey 必须与它们完全一致(同样传 getLocale()), 否则白发一次请求。
    const directions = await context.queryClient.ensureQueryData(
      context.trpc.digest.listDirections.queryOptions({ locale: getLocale() }),
    );
    const direction = directions.find((d) => d.slug === params.slug);
    if (!direction) throw notFound();
    return { directionName: direction.name };
  },
  head: ({ loaderData, params }) => {
    // SSR 拿得到方向名; loader 降级(D1 不可用)时退回 slug, 总比站点默认标题精确
    const name = loaderData?.directionName ?? params.slug;
    const title = `${name} | PicX`;
    const url = `${SITE_URL}/gallery/d/${params.slug}`;
    return {
      meta: [
        { title },
        { property: "og:title", content: title },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
});

/** 每页论文数。方向页主列是单栏宽卡, 8 篇约一屏半。 */
const PAGE_SIZE = 8;

const SKELETON_KEYS = Array.from(
  { length: 4 },
  (_, i) => `direction-skeleton-${i + 1}`,
);

/** getMyFeedback 的后端上限(zod max(90)); 无限滚动超过这个数就得分批。 */
const FEEDBACK_BATCH_SIZE = 90;

const SIDEBAR_HEADING =
  "text-[0.7rem] font-bold uppercase tracking-[0.18em] text-[var(--ink-soft)]";

function DirectionPage() {
  const { slug } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const trpc = useTRPC();
  const client = useTRPCClient();
  const locale = getLocale();

  const directionQuery = useQuery(
    trpc.digest.getDirection.queryOptions({ slug, locale }),
  );
  const direction = directionQuery.data;
  const issues = direction?.issues ?? [];
  const latestIssue = issues[0];
  // loader 给的名字先顶上, 免得刷新后标题位是空的(SSR 侧 locale 恒为 baseLocale,
  // 所以查询回来后仍会换成当前语言的名字)
  const name = direction?.name ?? loaderData?.directionName ?? slug;

  // 方向页无筛选栏: 不带 q/cat/tag/sort, 只按方向取最新。
  // 复用 GALLERY_LIST_QUERY_KEY 前缀是为了投票后能跟着一起失效刷新赞数
  // (见 feedback-buttons 的 invalidate 列表)。
  const papersQuery = useInfiniteQuery({
    queryKey: [GALLERY_LIST_QUERY_KEY, { direction: slug, locale }],
    queryFn: ({ pageParam, signal }) =>
      client.paper.listPublic.query(
        { page: pageParam, limit: PAGE_SIZE, locale, direction: slug },
        { signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) =>
      allPages.length * PAGE_SIZE < lastPage.total
        ? allPages.length + 1
        : undefined,
  });

  const papers = papersQuery.data?.pages.flatMap((p) => p.papers) ?? [];
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = papersQuery;

  // 无限滚动: 哨兵进视口就拉下一页。/gallery 那套 URL page 参数 + catch-up effect
  // 是为「深链回到第 N 页」服务的, 方向页没有筛选也没有分页深链, 直接调
  // fetchNextPage 就够 —— 代价是刷新后回到第一页(react-query 缓存内的前进后退不受影响)。
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) {
        fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // 反馈按钮的登录态, 与 /gallery、详情页同一口径: pending 不渲染(否则已登录用户
  // 会先看到一下登录墙), review-guest 只读账号禁用。
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const effectiveSession =
    session ??
    (isReviewGuestModeEnabled() ? getReviewGuestClientSession() : null);
  const feedbackAuth: FeedbackAuthState = isSessionPending
    ? "pending"
    : !effectiveSession
      ? "signed-out"
      : isReviewGuestReadOnlySession(effectiveSession)
        ? "readonly-guest"
        : "signed-in";

  // 未登录点赞时登录后回到当前地址, 而不是甩回首页
  const signInCallbackURL = useRouterState({
    select: (state) => state.location.href,
  });

  // 「我的投票」按页面批量取(后端单次最多 90 个 id, 无限滚动会超), 与 /gallery 同构。
  const feedbackBatches: string[][] = [];
  for (let i = 0; i < papers.length; i += FEEDBACK_BATCH_SIZE) {
    feedbackBatches.push(
      papers.slice(i, i + FEEDBACK_BATCH_SIZE).map((p) => p.id),
    );
  }
  const feedbackQueries = useQueries({
    queries: feedbackBatches.map((paperIds) => ({
      ...trpc.paper.getMyFeedback.queryOptions({ paperIds }),
      // protected procedure: 未登录发出去注定 401
      enabled: feedbackAuth === "signed-in",
    })),
  });
  // 只取 vote: 同一行的 reasonPreset 有意丢弃(见详情页注释)。
  const myVoteByPaperId = new Map<string, 1 | -1>();
  for (const query of feedbackQueries) {
    for (const [paperId, entry] of Object.entries(query.data ?? {})) {
      if (entry.vote === 1 || entry.vote === -1) {
        myVoteByPaperId.set(paperId, entry.vote);
      }
    }
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] py-8">
      <div className="page-wrap">
        <header className="rise-in mb-6">
          <h1 className="mb-4 font-serif text-3xl font-bold text-[var(--ink)] sm:text-4xl">
            {name}
          </h1>
          <DirectionTabs activeSlug={slug} />
        </header>

        {/* 宽屏: 主列(简报大卡 + 论文流) + 右侧边栏; 窄屏按 DOM 顺序堆叠, 边栏内容
            落在简报卡之后、论文流之前。边栏 row-span-2 让它自由长高, 不会把论文流
            往下顶出空档。 */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-x-10">
          <div className="lg:col-start-1 lg:row-start-1">
            {directionQuery.isLoading ? (
              <Skeleton className="h-44 rounded-2xl" />
            ) : latestIssue ? (
              <DigestIssueCard
                slug={slug}
                issueNumber={latestIssue.issueNumber}
                title={latestIssue.title}
                publishedAt={latestIssue.publishedAt}
                excerpt={direction?.latestExcerpt ?? ""}
              />
            ) : (
              <DigestEmptyIssueCard />
            )}
          </div>

          <aside className="mt-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
            <section>
              <h2 className={SIDEBAR_HEADING}>{m.digest_current_focus()}</h2>
              {directionQuery.isLoading ? (
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ) : direction?.focusBrief ? (
                // 纯文本, 不渲染 markdown(这段是喂 LLM 的方向说明, 不含标记)
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-[var(--ink-soft)]">
                  {direction.focusBrief}
                </p>
              ) : null}
            </section>

            {/* 最新一期已经是上面那张大卡, 这里只列比它更早的期次 */}
            {issues.length > 1 ? (
              <section className="mt-8">
                <h2 className={`${SIDEBAR_HEADING} mb-3`}>
                  {m.digest_past_issues()}
                </h2>
                <IssueList slug={slug} issues={issues.slice(1)} />
              </section>
            ) : null}
          </aside>

          {/* 论文流为空时有意什么都不渲染: /gallery 的空态是「来上传第一篇」, 而方向
              论文流是管线挑出来的, 用户上传帮不上忙, 挂那句 CTA 只会误导; 此时上面
              那张卡已经在说「首期简报生成中」, 状态交代清楚了。 */}
          <div className="mt-8 lg:col-start-1 lg:row-start-2">
            {papersQuery.isLoading ? (
              <div className="grid auto-rows-fr gap-5">
                {SKELETON_KEYS.map((key) => (
                  <GalleryCardSkeleton key={key} />
                ))}
              </div>
            ) : papers.length > 0 ? (
              <div className="grid auto-rows-fr gap-5">
                {papers.map((paper, index) => (
                  <GalleryCard
                    key={paper.id}
                    paper={paper}
                    delay={`${index * 50}ms`}
                    // 不传 directionLabel: 这一整列都是本方向的论文, 每张卡再挂一枚
                    // 写着当前方向名、点了跳回本页的徽标纯属噪音。
                    myVote={myVoteByPaperId.get(paper.id)}
                    feedbackAuth={feedbackAuth}
                    signInCallbackURL={signInCallbackURL}
                  />
                ))}
              </div>
            ) : null}

            {/* 滚动到哨兵自动加载; 按钮是无障碍 / 兜底入口 */}
            {hasNextPage ? (
              <div ref={loadMoreRef} className="mt-10 flex justify-center">
                {isFetchingNextPage ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    {m.gallery_loading()}
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => fetchNextPage()}>
                    {m.gallery_load_more()}
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
