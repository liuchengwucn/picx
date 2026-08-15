import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, isNotFound, notFound } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  DigestEmptyIssueCard,
  DigestIssueCard,
} from "#/components/digest/digest-issue-card";
import { DirectionTabs } from "#/components/digest/direction-tabs";
import { IssueList } from "#/components/digest/issue-list";
import {
  GalleryCard,
  GalleryCardSkeleton,
} from "#/components/papers/gallery-card";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { usePaperFeedback } from "#/hooks/use-paper-feedback";
import { useTRPC, useTRPCClient } from "#/integrations/trpc/react";
import {
  directionIntroSource,
  LOCALE_KEYS,
  type LocaleKey,
} from "#/lib/digest/present";
import { GALLERY_LIST_QUERY_KEY } from "#/lib/gallery-search";
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
   * 页面本身仍是客户端渲染, loader 只做两件小事: 校验 slug 存在, 并给 <head> 一份
   * 方向名 + 公开简介 intro 做标题和描述。简报/论文内容一概不在这里预取。
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
          .select({
            name: directions.name,
            intro: directions.intro,
            // 只为 intro 未生成时包装成回退对象用（见下方 directionIntroSource）
            focusBrief: directions.focusBrief,
          })
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
        // 今天这里恒为 baseLocale en(paraglide 的策略全在客户端解析), 但两个字段必须
        // 用同一个 key: 哪天 SSR 真拿到 locale, 别变成日文标题配英文描述。
        const localeKey = normalizeLocaleKey(getLocale());
        const introSource = directionIntroSource(row);
        return {
          directionName: pickTldr(row.name, localeKey),
          intro: pickTldr(introSource, localeKey),
          // head 专用四语字段(照 /p/$shortId 的 ssrMeta 模式): 上面两个单语字段被
          // 冻结在 SSR 那次的 locale, 而 head() 在客户端会随语言重算 —— 按 locale
          // 展开, 让 head 用 getLocale() 自己挑。intro 逐语言先截 160 字符做描述,
          // 不把四份完整 intro 打进 dehydrate payload。
          headI18n: {
            directionName: row.name,
            intro: Object.fromEntries(
              LOCALE_KEYS.map((k) => [
                k,
                pickTldr(introSource, k)?.slice(0, 160) ?? "",
              ]),
            ) as Record<LocaleKey, string>,
          },
          ssrFailed: false,
        };
      } catch (error) {
        // notFound 必须穿透; 其余错误(D1 不可用等)降级为纯 CSR。
        // 降级会让一个本该 404 的 slug 拿到 200, 组件那边还有一道 data === null 的
        // 兜底; 但故障本身不能就这么无声无息, 留日志。
        if (isNotFound(error)) throw error;
        console.error("[direction loader] SSR D1 read failed", error);
        // ssrFailed 是给 head() 用的: 这一帧既证明不了 slug 存在、也拿不到方向名,
        // 必须 noindex 且不发 canonical(见 head 里的注释)。
        return {
          directionName: null,
          intro: null,
          headI18n: null,
          ssrFailed: true,
        };
      }
    }

    // 客户端导航: 复用 DirectionTabs / gallery 列表页那次 listDirections。
    // queryKey 必须与它们完全一致(同样传 getLocale()), 否则白发一次请求。
    const directions = await context.queryClient.ensureQueryData(
      context.trpc.digest.listDirections.queryOptions({ locale: getLocale() }),
    );
    const direction = directions.find((d) => d.slug === params.slug);
    if (!direction) throw notFound();
    // listDirections 不含 intro, 客户端导航时描述留空: meta 只对爬虫有意义,
    // 而爬虫拿的永远是 SSR 那份。为一句 description 再发一次 getDirection 不值。
    return {
      directionName: direction.name,
      intro: null,
      // 客户端导航拿到的已经是当前 locale 的方向名, head 直接用 directionName 即可
      headI18n: null,
      ssrFailed: false,
    };
  },
  head: ({ loaderData, params }) => {
    // SSR 读失败时的降级帧, 与简报期页 ssrFailed 同一口径: 这一帧没有任何证据说明
    // 这个 slug 存在(下线或压根不存在的方向本该 404, 降级把它变成了 200), 组件要到
    // 客户端拿到 listDirections 才会补 notFound() —— 不执行 JS 的抓取方看到的就是一个
    // 软 404。所以 noindex, 且不发 canonical / og:url: 自指 canonical 等于主动请求收录。
    // 标题也只能退回 slug(方向名没读出来), 更不该拿它去当 og 卡片。
    if (loaderData?.ssrFailed) {
      return {
        meta: [
          { title: `${params.slug} | PicX` },
          { name: "robots", content: "noindex" },
        ],
      };
    }

    // SSR 分支带 headI18n: directionName/intro 被冻结在 SSR 那次的 locale, 而 head
    // 在客户端会随语言重算, 用 getLocale() 从四语 Record 里自己挑(回退顺序走
    // pickTldr, 与 SSR 单语字段同口径)。客户端导航分支没有 headI18n: 那份
    // directionName 本来就是当前 locale 的, 直接用, 行为与从前一致。
    const headI18n = loaderData?.headI18n;
    const localeKey = normalizeLocaleKey(getLocale());
    const name = headI18n
      ? (pickTldr(headI18n.directionName, localeKey) ?? params.slug)
      : (loaderData?.directionName ?? params.slug);
    const title = `${name} | PicX`;
    const url = `${SITE_URL}/gallery/d/${params.slug}`;
    // intro 就是边栏「当前关注」那段公开文本, 截断做描述。没有 headI18n 的分支
    // (客户端导航/降级帧)里 intro 恒为 null, 描述留空 —— 与从前一致(meta 只对爬虫
    // 有意义, 爬虫拿的永远是 SSR 那份)。
    const description = headI18n
      ? headI18n.intro[localeKey] || undefined
      : (loaderData?.intro ?? undefined);
    const meta: Array<
      | { title: string }
      | { name: string; content: string }
      | {
          property: string;
          content: string;
        }
    > = [{ title }];
    if (description) {
      meta.push({ name: "description", content: description });
    }
    meta.push(
      { property: "og:title", content: title },
      { property: "og:url", content: url },
    );
    if (description) {
      meta.push({ property: "og:description", content: description });
    }
    return { meta, links: [{ rel: "canonical", href: url }] };
  },
});

/** 每页论文数。方向页主列是单栏宽卡, 8 篇约一屏半。 */
const PAGE_SIZE = 8;

const SKELETON_KEYS = Array.from(
  { length: 4 },
  (_, i) => `direction-skeleton-${i + 1}`,
);

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

  // 反馈按钮装配(登录态口径 / 登录回跳地址 / 「我的投票」分批取)三个页面共用,
  // 细节与陷阱都在 usePaperFeedback 里。
  const { feedbackAuth, signInCallbackURL, myVoteByPaperId } = usePaperFeedback(
    papers.map((p) => p.id),
  );

  // getDirection 返回 null = 方向不存在或已下线。正常路径上 loader 已经拦掉了, 这里
  // 兜的是两种漏网情况: SSR 那次 D1 读失败导致 loader 降级放行, 以及 loader 之后方向
  // 刚被下线。不兜的话会渲染出一个 h1 是 slug、卡片写着「首期简报生成中」的 200 假页面
  // (软 404)。放在所有 hook 之后, 免得抛出那次渲染的 hook 数量对不上。
  if (directionQuery.data === null) throw notFound();

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
            {/* 查询失败要与「还没有简报」分得开: 后者是虚线空态卡「首期简报生成中」,
                把加载失败也说成生成中等于对用户撒谎。 */}
            {directionQuery.isError ? (
              <LoadFailedCard />
            ) : directionQuery.isLoading ? (
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
            {/* 查询失败时整节隐掉: 主列那张卡已经把失败说清楚了, 这里再留一个孤零零
                的「当前关注」标题只是噪音。 */}
            {directionQuery.isError ? null : (
              <section>
                <h2 className={SIDEBAR_HEADING}>{m.digest_current_focus()}</h2>
                {directionQuery.isLoading ? (
                  <div className="mt-3 space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                ) : direction?.intro ? (
                  // 纯文本, 不渲染 markdown(这段是生成的方向简介, 不含标记)
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-[var(--ink-soft)]">
                    {direction.intro}
                  </p>
                ) : null}
              </section>
            )}

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
              那张卡已经在说「首期简报生成中」, 状态交代清楚了。加载失败则相反, 必须
              说出来, 否则和「这个方向暂时没有论文」长得一模一样。

              网格是单列(不像 /gallery 的 lg:grid-cols-2): 主列被 280px 边栏挤掉一截后,
              横向宽卡再切两列, 每张只剩约 400px, 缩略图一占就没有正文位置了。 */}
          <div className="mt-8 lg:col-start-1 lg:row-start-2">
            {papersQuery.isError ? (
              <p className="py-12 text-center text-sm text-[var(--ink-soft)]">
                {m.digest_load_failed()}
              </p>
            ) : papersQuery.isLoading ? (
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

/**
 * 简报大卡位的加载失败态。实线边 + 常规底色, 与空态卡的虚线边区分开:
 * 虚线 = 内容还没生成, 实线 = 内容应该在但这次没取到。
 */
function LoadFailedCard() {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-5 sm:p-6">
      <p className="text-sm text-[var(--ink-soft)]">{m.digest_load_failed()}</p>
    </div>
  );
}
