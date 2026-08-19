import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, isNotFound, notFound } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { DirectionTabs } from "#/components/digest/direction-tabs";
import { IssueTimeline } from "#/components/digest/issue-timeline";
import { ModuleKicker } from "#/components/home/module-kicker";
import {
  GalleryCard,
  GalleryCardSkeleton,
} from "#/components/papers/gallery-card";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { LoadFailedPanel, PendingPanel } from "#/components/ui/state-panel";
import { usePaperFeedback } from "#/hooks/use-paper-feedback";
import { useTRPC, useTRPCClient } from "#/integrations/trpc/react";
import {
  assignDirectionHues,
  directionAccent,
} from "#/lib/digest/direction-color";
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
        // 动态 import: edition-store 拽进整份 schema, 静态引会把它打进客户端包
        const { listDirectionColorInputs } = await import(
          "#/lib/digest/edition-store"
        );
        const db = drizzle((env as typeof env & AppEnvBindings).DB);
        // 两条互不依赖, 并成一批而不是两次串行往返
        const [[row], colorInputs] = await Promise.all([
          db
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
            .limit(1),
          listDirectionColorInputs(db),
        ]);
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
          // 方向识别色的输入(全量 active 方向的 slug + createdAt)。少了它服务端渲染
          // 不出真色相, 栏眉方块在 HTML 里永远是灰的 —— 对不执行 JS 的抓取方就是
          // 永久灰色, 对读者是每次加载先灰一下再变色。与落地页 / 合刊永久链接的
          // ssrDirections 同一处理。
          ssrDirections: colorInputs,
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
          ssrDirections: null,
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
      // 客户端导航不需要这份回退: 上面那次 ensureQueryData 已经把 listDirections
      // 填进缓存, 组件第一帧就能拿到真色相
      ssrDirections: null,
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

/** 每页论文数。边栏取消后主列变宽、卡片回到两列, 8 篇正好四行。 */
const PAGE_SIZE = 8;

const PAPER_SKELETON_KEYS = Array.from(
  { length: 4 },
  (_, i) => `direction-paper-skeleton-${i + 1}`,
);

const TIMELINE_SKELETON_KEYS = Array.from(
  { length: 3 },
  (_, i) => `direction-timeline-skeleton-${i + 1}`,
);

function DirectionPage() {
  const { slug } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const trpc = useTRPC();
  const client = useTRPCClient();
  const locale = getLocale();

  // 期次时间线。累加式翻页(useInfiniteQuery)而不是「换一页游标」的替换式: 这一节是
  // 编年史, 替换掉已经读过的部分之后「更早的期次」就变成了跳到第二页, 读者手里的时间
  // 上下文没了。
  //
  // 走 tRPC 自带的 infiniteQueryOptions 而不是手写 queryKey: 手写键拿到的是一个
  // tRPC 不认识的 key, 于是 getDirection.pathKey() 从此覆盖不到它 —— 将来任何一处
  // 「投票/发布后失效方向数据」的代码都会静默漏掉这一条(feedback-buttons 里那份
  // 失效清单就为另一个手写键专门留着一条警告)。代价只是 router 输入字段必须叫
  // cursor, 见 digest.ts 里的注释。
  //
  // 失效时注意: infinite query 的 key 带 type:"infinite", `queryKey()` 生成的是
  // type:"query", 两者互不匹配 —— 要失效这条只能用 pathKey()。
  const issuesQuery = useInfiniteQuery(
    trpc.digest.getDirection.infiniteQueryOptions(
      { slug, locale },
      {
        // 游标是排他的(store 里是 lt(issueNumber)), 所以传上一页最后一条的期号。
        // 用期号而不是 offset: 两次翻页之间又发布了一期时 offset 会整体错位。
        getNextPageParam: (lastPage) =>
          lastPage?.hasMore
            ? (lastPage.issues[lastPage.issues.length - 1]?.issueNumber ?? null)
            : null,
      },
    ),
  );
  // getDirection 每页都会重复带回 name/intro/三个计数(重复字段体积很小, 换来一次
  // 往返就拿全页头)。页头只认第一页那份 —— 别把它们也 flatMap 了。
  const detail = issuesQuery.data?.pages[0];
  const issues = useMemo(
    () => issuesQuery.data?.pages.flatMap((p) => p?.issues ?? []) ?? [],
    [issuesQuery.data],
  );
  // loader 给的名字与简介先顶上: SSR 那一帧就有真内容(而不是刷新后标题位空着、
  // 爬虫只拿到一个空壳), 查询回来后再换成当前语言的那份。intro 用 ?? 而不是 ||:
  // 查询明确返回空串就是「这个方向还没有 intro」, 不该把 loader 那份再复活。
  const name = detail?.name ?? loaderData?.directionName ?? slug;
  const intro = detail?.intro ?? loaderData?.intro ?? "";

  // 方向识别色: 读者从合刊某个栏目(那枚 7px 方块)点进来, 落到方向自己的主页上应该
  // 看到同一块颜色, 否则「颜色 = 方向身份」这条约定只在合刊里成立。
  //
  // 但这个一致性有确切边界, 别当成全局不变式: 色相是按「输入集合 + createdAt 先到
  // 先得」分配的, 输入集合多一个 slug 就可能挤动其它方向的槽位。本页喂的是全量
  // **active** 方向, 而合刊页喂的是 allDirections ∪ 本期栏目 —— 两者在 /gallery
  // (只含 active 方向的当期)上相同, 但某一期历史合刊若含有一个**已下线**方向的栏目,
  // 那一页的输入集合就多一个成员, 同一个活跃方向在两页上可能拿到不同方块色。
  //
  // listDirections 是 DirectionTabs 本来就在发的那一条(同 key 同参数), react-query
  // 去重, 不多一次请求。
  const directionsQuery = useQuery({
    ...trpc.digest.listDirections.queryOptions({ locale }),
    staleTime: 5 * 60_000,
  });
  const accent = useMemo(() => {
    // 客户端第一帧(以及不执行 JS 的抓取方)这条 query 还没数据, 回退到 loader 那份
    // SSR 输入, 否则方块要么永久是灰的、要么每次加载先灰一下再变色。两份输入是同一
    // 条 listDirectionColorInputs, 所以分配结果一致, 不构成 hydration mismatch。
    const dirs = directionsQuery.data ?? loaderData?.ssrDirections;
    if (!dirs?.length) return null;
    // 色相表必须按全量 active 方向建(先到先得的让位取决于输入集合), 不能只喂本方向
    const hue = assignDirectionHues(dirs).get(slug);
    return hue === undefined ? null : directionAccent(hue);
  }, [directionsQuery.data, loaderData?.ssrDirections, slug]);

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
  // 改名是为了与期次时间线那条 infinite query 分得开: 本页有两条分页流, 裸
  // hasNextPage / fetchNextPage 在 JSX 里读不出是哪一条的。
  const {
    fetchNextPage: fetchMorePapers,
    hasNextPage: hasMorePapers,
    isFetchingNextPage: isFetchingMorePapers,
  } = papersQuery;

  // 无限滚动: 哨兵进视口就拉下一页。/gallery 那套 URL page 参数 + catch-up effect
  // 是为「深链回到第 N 页」服务的, 方向页没有筛选也没有分页深链, 直接调
  // fetchNextPage 就够 —— 代价是刷新后回到第一页(react-query 缓存内的前进后退不受影响)。
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMorePapers) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingMorePapers) {
        fetchMorePapers();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMorePapers, isFetchingMorePapers, fetchMorePapers]);

  // 反馈按钮装配(登录态口径 / 登录回跳地址 / 「我的投票」分批取)三个页面共用,
  // 细节与陷阱都在 usePaperFeedback 里。
  const { feedbackAuth, signInCallbackURL, myVoteByPaperId } = usePaperFeedback(
    papers.map((p) => p.id),
  );

  // getDirection 返回 null = 方向不存在或已下线。正常路径上 loader 已经拦掉了, 这里
  // 兜的是两种漏网情况: SSR 那次 D1 读失败导致 loader 降级放行, 以及 loader 之后方向
  // 刚被下线。不兜的话会渲染出一个 h1 是 slug、时间线写着「首期简报生成中」的 200
  // 假页面(软 404)。放在所有 hook 之后, 免得抛出那次渲染的 hook 数量对不上。
  if (issuesQuery.data?.pages[0] === null) throw notFound();

  return (
    <main className="min-h-screen bg-[var(--bg)] py-8">
      {/* max-w-5xl 与合刊页 / 单期页同一族: 这一页的上半是读物(引言段 + 编年史),
          1200px 的 page-wrap 留给档案那种多列检索页 —— 主列再宽就没人从行尾走回
          行首了。两列卡片在这个宽度下每张约 490px, 与档案页在笔记本视口上相当。 */}
      <div className="page-wrap max-w-5xl">
        <DirectionTabs activeSlug={slug} />

        {/* 一、为什么跟踪这个方向。intro 从旧版右边栏 150px 的小字提到正文位:
            它正是「这个方向为什么值得看」的答案, 也是这一页唯一只有它能回答的问题。 */}
        <header className="rise-in mt-6">
          <ModuleKicker
            as="div"
            // 方块用方向识别色, 文字仍是 --ink-soft(ModuleKicker 的既有约定: 别把
            // color 传给文字)。未到货 / listDirections 失败时退 --ink-soft, 不退某个
            // 默认色相 —— 本页只有一枚方块, 不存在「两个方向撞成同一块铁锈色」那种
            // 只能靠眼睛发现的错, 但假色相会让读者学到错的身份色。灰方块只是
            // 「还没认出身份」, 是诚实的。
            color={accent ?? "var(--ink-soft)"}
          >
            {m.direction_eyebrow()}
          </ModuleKicker>
          <h1 className="mt-2 font-serif text-3xl font-bold leading-tight text-[var(--ink)] sm:text-4xl">
            {name}
          </h1>
          {intro ? (
            // 纯文本, 不渲染 markdown(这段是生成的方向简介, 不含标记)。左侧 2px 引线
            // 是引用语义(与标题金色划线同一套语义), 不是装饰。62ch 是这一页唯一的正文
            // 测量: 不封口的话在宽屏会拉成一行一百多字符。
            <p className="mt-4 max-w-[62ch] whitespace-pre-line border-l-2 border-[var(--academic-brown)]/45 pl-4 text-[15px] leading-relaxed text-[var(--ink)] sm:text-base">
              {intro}
            </p>
          ) : null}
          {detail ? (
            // 一条 message 装完整句(连中点), 与刊头的 edition_meta_* 完全同款:
            // 分隔符与语序都归译者。在 JS 里 join 已翻译的片段等于把语序钉死成
            // 「A · B · C」, 哪个语言想换顺序或换分隔符都无从下手。
            // 纯文本, 不给底色不描边(「dateline 信息带」是红线)。
            <p className="mt-4 text-[11px] leading-relaxed text-[var(--ink-soft)]">
              {m.direction_stats({
                issues: String(detail.issueCount),
                papers: String(detail.paperCount),
              })}
            </p>
          ) : issuesQuery.isLoading ? (
            // 占位而不是留空: 这一行到货时会把下面整页往下推一行
            <Skeleton className="mt-4 h-3.5 w-64 max-w-full" />
          ) : null}
        </header>

        {/* 二、这个方向发生过什么 */}
        <section className="mt-10">
          <ModuleKicker as="h2" color="var(--ink-soft)">
            {m.direction_issues_heading()}
          </ModuleKicker>
          <div className="mt-3">
            {/* 三态各自独立判定, 不与论文流共用一个全局态: 一节失败不该把另一节也
                说成坏的。读失败绝不说成空态(虚线面板写的是「生成中」, 那是对用户
                撒谎), 也绝不回 404 —— 实线面板 + 必填重试。 */}
            {issuesQuery.isError && issues.length === 0 ? (
              <LoadFailedPanel onRetry={() => issuesQuery.refetch()} />
            ) : issuesQuery.isLoading ? (
              <TimelineSkeleton />
            ) : detail?.issueCount === 0 ? (
              <PendingPanel message={m.digest_empty_issue()} />
            ) : (
              <>
                <IssueTimeline slug={slug} issues={issues} />
                {issuesQuery.isError ? (
                  // 翻页失败(react-query 保留旧 data, 只把 status 翻成 error): 已经
                  // 读到的编年史留在原位, 面板只接管按钮那一格, 重试 = 再取那一页。
                  // 拿失败面板把好内容盖掉是这一处最容易踩的错。
                  <div className="mt-6">
                    <LoadFailedPanel
                      onRetry={() => issuesQuery.fetchNextPage()}
                    />
                  </div>
                ) : issuesQuery.hasNextPage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-5"
                    disabled={issuesQuery.isFetchingNextPage}
                    onClick={() => issuesQuery.fetchNextPage()}
                  >
                    {issuesQuery.isFetchingNextPage ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : null}
                    {/* 「更早的期次」而不是「加载更多」: 这一节是往前接着读, 文案要
                        说清方向 */}
                    {m.direction_older_issues()}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </section>

        {/* 三、这个方向积累了什么。

            空态是**整节不渲染**, 包括栏眉 —— 判据挂在 <section> 上而不是只挡住内层
            网格: 只挡网格的话屏幕上会留下「■ 本方向论文」+ 一条发丝线 + 下面一片空,
            那是个自己承诺了内容又不给的标题。旧版边栏就是这么写的(「查询失败时整节
            隐掉……再留一个孤零零的标题只是噪音」), 重写时这条理由丢过一次。

            这不是边缘情况: paperCount === 0 是每个新方向的初始状态。

            为什么空态不给任何文案(既不给「来上传第一篇」也不给「生成中」):
            - /gallery 的空态 CTA 是「来上传第一篇」, 但方向论文是管线挑出来的,
              用户上传帮不上忙, 那句 CTA 只会误导。
            - 头部统计行已经把这件事说出来了 —— 它印着「Papers picked: 0」。空档没有
              悬念, 不需要第二处文案再解释一遍。
            - issueCount === 0 时上面那节还额外在说「首期简报生成中」。
            - issueCount > 0 而这里为 0, 只可能是「入选了但默认白板还没生成」(画廊卡
              以白板图为主体, 无图不列, 见 lib/paper-visibility.ts)。那是个短暂窗口
              (线上 62 篇入选里 61 篇有图); 想看那一期的全部 picks, 时间线上每一条都
              点得进去(期页用 leftJoin, 无图论文照常列)。
            加载失败则相反, 必须说出来, 否则和「这个方向暂时没有论文」长得一模一样。 */}
        {papersQuery.isError || papersQuery.isLoading || papers.length > 0 ? (
          <section className="mt-14">
            <ModuleKicker as="h2" color="var(--ink-soft)">
              {m.direction_papers_heading()}
            </ModuleKicker>
            <div className="mt-4">
              {papersQuery.isError && papers.length === 0 ? (
                <LoadFailedPanel onRetry={() => papersQuery.refetch()} />
              ) : papersQuery.isLoading ? (
                <div className="grid auto-rows-fr gap-5 lg:grid-cols-2">
                  {PAPER_SKELETON_KEYS.map((key) => (
                    <GalleryCardSkeleton key={key} />
                  ))}
                </div>
              ) : (
                // 右边栏取消后主列变宽, 卡片回到两列(与档案页同一网格)
                <div className="grid auto-rows-fr gap-5 lg:grid-cols-2">
                  {papers.map((paper, index) => (
                    <GalleryCard
                      key={paper.id}
                      paper={paper}
                      delay={`${index * 50}ms`}
                      // 不传 directionLabel: 这一整节都是本方向的论文, 每张卡再挂一枚
                      // 写着当前方向名、点了跳回本页的徽标纯属噪音。
                      myVote={myVoteByPaperId.get(paper.id)}
                      feedbackAuth={feedbackAuth}
                      signInCallbackURL={signInCallbackURL}
                    />
                  ))}
                </div>
              )}

              {/* 与时间线同一口径: 翻页失败保留已加载的卡片, 面板只接管加载位。
                  否则滚到底时一次网络抖动会把整列论文抹掉。 */}
              {papersQuery.isError && papers.length > 0 ? (
                <div className="mt-10">
                  <LoadFailedPanel onRetry={() => fetchMorePapers()} />
                </div>
              ) : hasMorePapers ? (
                // 滚动到哨兵自动加载; 按钮是无障碍 / 兜底入口
                <div ref={loadMoreRef} className="mt-10 flex justify-center">
                  {isFetchingMorePapers ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      {m.gallery_loading()}
                    </div>
                  ) : (
                    <Button variant="outline" onClick={() => fetchMorePapers()}>
                      {m.gallery_load_more()}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

/**
 * 期次时间线的骨架。形状贴真实排版(左栏账目 + 右栏标题/摘要两行)而不是一块通用
 * 灰条: 通用条块只会让读者以为页面坏了 —— 这也正是三态里「骨架」不放进
 * state-panel.tsx 的原因(见那边的注释)。
 */
function TimelineSkeleton() {
  return (
    <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
      {TIMELINE_SKELETON_KEYS.map((key) => (
        <div
          key={key}
          className="grid gap-x-6 gap-y-2 py-4 sm:grid-cols-[9rem_minmax(0,1fr)]"
        >
          <Skeleton className="h-3 w-28" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full max-w-[42ch]" />
          </div>
        </div>
      ))}
    </div>
  );
}
