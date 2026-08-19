import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  isNotFound,
  Link,
  notFound,
  useRouter,
} from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { DigestPaperCard } from "#/components/digest/digest-paper-card";
import { Skeleton } from "#/components/ui/skeleton";
import { LoadFailedPanel } from "#/components/ui/state-panel";
import { usePaperFeedback } from "#/hooks/use-paper-feedback";
import { useTRPC } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";
import {
  excerptByLocale,
  excerptFromMarkdown,
  mapIssueToLocale,
} from "#/lib/digest/present";
import { SITE_URL } from "#/lib/site-url";
import { normalizeLocaleKey, pickTldr } from "#/lib/tldr";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

interface AppEnvBindings {
  DB: D1Database;
}

/** SSR 直读 D1 那份必须与 digest.getIssue 的输出同构, 才能当 react-query 的 initialData */
type IssueOutput = NonNullable<
  inferRouterOutputs<TRPCRouter>["digest"]["getIssue"]
>;

export const Route = createFileRoute("/gallery/d/$slug_/$issue")({
  component: DigestIssuePage,
  // 两者刻意分开: 「这期不存在」与「这次没读出来」对读者是两件事, 用同一个组件糊过去
  // 就等于把故障说成 404。
  notFoundComponent: IssueNotFound,
  // 客户端导航时 ensureQueryData 抛出(网络故障)会冒到这里, 与 /gallery/w/$period
  // 同一处理: 路由注入的是 {error, info, reset}, 不是页面内那份 query, 所以另开一个
  // 薄壳组件把 router.invalidate() 接到 IssueLoadFailed 需要的 onRetry 上。
  errorComponent: IssueRouteError,
  loader: async ({ context, params }) => {
    // 路由段是任意字符串, 期号只认「无前导零的正整数字面量」。校验原始字符串而不是
    // Number() 的结果: Number 会把 "001" / "1.0" / "+1" / "0x1" / " 1" / "1e3" 全部
    // 收成合法整数, 于是同一期能从无数个 URL 打开(canonical 只能收敛索引, 挡不住
    // 这些地址各自渲染一遍)。非法期号一律 404。
    if (!/^[1-9]\d*$/.test(params.issue)) throw notFound();
    const issueNumber = Number(params.issue);

    if (import.meta.env.SSR) {
      // 简报正文就是本页的全部内容, 必须进首个 HTML 响应(爬虫 / 分享卡片都只看它)。
      // 服务端不能走 queryClient.ensureQueryData: tRPC client 在 SSR 侧指向
      // localhost, 部署到 Workers 里发不出去; 而且那个 queryClient 是模块级单例,
      // 在 isolate 内跨请求共享, 服务端往里写缓存有串号风险。与 /p /news 一致 —— 直读 D1。
      const localeKey = normalizeLocaleKey(getLocale());
      try {
        const { env } = await import("cloudflare:workers");
        const { drizzle } = await import("drizzle-orm/d1");
        const { getPublishedIssueDetail } = await import("#/lib/digest/store");
        const db = drizzle((env as typeof env & AppEnvBindings).DB);
        const issue = await getPublishedIssueDetail(
          db,
          params.slug,
          issueNumber,
        );
        // 查不到 → 真 404 状态码, 不是 200 空壳。getPublishedIssueDetail 返回 null 的
        // 全部情形: 方向 slug 不存在 / 方向已下线(isActive=0) / 该期不是 published /
        // 期号没有对应的期。「方向已下线」这一档连历史 published 期一起 404, 与
        // listDirections、getDirection 以及 sitemap / llms 两个路由同一口径。
        if (!issue) throw notFound();
        // 显式标注类型 = 编译期钉住「与 getIssue 输出同构」这条契约
        const ssrData: IssueOutput = mapIssueToLocale(issue, localeKey);
        return {
          ssrData,
          // head 专用四语字段(照 /p/$shortId 的 ssrMeta 模式): body 用的 ssrData
          // 必须保持 SSR 时定死的单语(hydration 首帧一致性), 但 head() 在客户端会
          // 随语言重算 —— 把标题/方向名/摘要按 locale 展开, 让 head 用 getLocale()
          // 自己挑。description 逐语言抽好短摘要, 不把四份完整 markdown 带下去。
          headI18n: {
            title: issue.title,
            directionName: issue.directionName,
            description: excerptByLocale(issue.content),
          },
          ssrLocaleKey: localeKey,
          ssrFailed: false,
        };
      } catch (error) {
        // notFound 必须穿透
        if (isNotFound(error)) throw error;
        // D1 不可用等: 降级为纯 CSR(客户端那次查询能把正文补回来), 但不能悄悄降级 ——
        // 故障要留日志, 页面也要照实说「没读出来」, 既不能装成 404, 也不能装成
        // 「简报还没生成」。
        console.error("[digest issue loader] SSR D1 read failed", error);
        return {
          ssrData: null,
          headI18n: null,
          ssrLocaleKey: localeKey,
          ssrFailed: true,
        };
      }
    }

    const ssrData = await context.queryClient.ensureQueryData(
      context.trpc.digest.getIssue.queryOptions({
        slug: params.slug,
        issueNumber,
        locale: getLocale(),
      }),
    );
    if (!ssrData) throw notFound();
    return {
      ssrData,
      // 客户端导航拿到的已经是当前 locale 的单语数据, head 直接用 ssrData 即可
      headI18n: null,
      ssrLocaleKey: normalizeLocaleKey(getLocale()),
      ssrFailed: false,
    };
  },
  head: ({ loaderData, params }) => {
    const issue = loaderData?.ssrData;
    if (!issue) {
      // 两种情况, 标签页标题要能分辨(这是读者唯一能看到状态的地方之一):
      // loaderData 为空 = loader 抛了 notFound; ssrFailed = D1 读失败。
      // 两种都不该进索引, 也都不发 canonical —— 期号可能压根不是数字。
      const title = loaderData?.ssrFailed
        ? m.digest_issue_error_title()
        : m.digest_issue_not_found_title();
      return {
        meta: [
          { title: `${title} | PicX` },
          { name: "robots", content: "noindex" },
        ],
      };
    }

    // SSR 分支带 headI18n: loaderData 里的 ssrData 被冻结在 SSR 那次的 locale, 而
    // head 在客户端会随语言重算, 所以要用 getLocale() 从四语 Record 里自己挑(回退
    // 顺序走 pickTldr, 与 mapIssueToLocale 同口径)。客户端导航分支没有 headI18n:
    // 那份 ssrData 本来就是当前 locale 的单语数据, 直接用, 行为与从前一致。
    const headI18n = loaderData?.headI18n;
    const localeKey = normalizeLocaleKey(getLocale());
    const titleText = headI18n
      ? (pickTldr(headI18n.title, localeKey) ?? "")
      : issue.title;
    const directionName = headI18n
      ? (pickTldr(headI18n.directionName, localeKey) ?? params.slug)
      : issue.directionName;
    const url = `${SITE_URL}/gallery/d/${params.slug}/${issue.issueNumber}`;
    const title = `${titleText} | ${directionName} | PicX`;
    // 正文首段纯文本当描述; 抽不出来(正文只有标题行)就整组略过, 不发空 description
    const description = headI18n
      ? headI18n.description[localeKey]
      : excerptFromMarkdown(issue.content);
    const meta: Array<
      | { title: string }
      | { name: string; content: string }
      | {
          property: string;
          content: string;
        }
    > = [
      { title },
      { property: "og:title", content: title },
      { property: "og:type", content: "article" },
      { property: "og:url", content: url },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
    ];
    if (description) {
      meta.push(
        { name: "description", content: description },
        { property: "og:description", content: description },
        { name: "twitter:description", content: description },
      );
    }
    return { meta, links: [{ rel: "canonical", href: url }] };
  },
});

// 模块级常量: 每次渲染新建数组/对象会让 react-markdown 认为插件变了, 白重跑一遍解析。
//
// 不挂 remark-math / rehype-katex 是有意的: 生成侧(src/lib/digest/ai.ts 的定稿提示词)
// 只约定了「行内 markdown 链接」, 没有任何数学写法约定, 正文是散文。引进来是净风险 ——
// 换来的是把正文里出现的每个 $ 都变成公式定界符, 外加一份 katex CSS。哪天生成侧开始
// 产公式, 再照 p/$shortId 的配置补上。
const REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_COMPONENTS: Components = {
  // 正文里的链接一律指向站外原始出处(生成时就要求每个论断挂 [标题](URL)),
  // 新标签页打开, 并断掉 window.opener。
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

function DigestIssuePage() {
  const { slug, issue } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const trpc = useTRPC();
  const locale = getLocale();
  const localeKey = normalizeLocaleKey(locale);
  const issueNumber = Number(issue);

  const ssrData = loaderData.ssrData ?? undefined;
  // SSR 那份是按服务端解析出的 locale 渲染的; 对不上就立刻重取, 否则 root-provider 的
  // 默认 staleTime(60s)会把另一种语言的正文按住一分钟(与 /gallery、/gallery/w/$period
  // 同一处理)。
  const staleSsrLocale =
    ssrData !== undefined && loaderData.ssrLocaleKey !== localeKey;
  const query = useQuery({
    ...trpc.digest.getIssue.queryOptions({ slug, issueNumber, locale }),
    initialData: ssrData,
    // 只在语言对不上时压掉 staleTime; 平时这个键**根本不出现**。写成
    // `staleTime: staleSsrLocale ? 0 : undefined` 会反过来: 选项是
    // `{...defaults.queries, ...options}` 展开合并, 显式 undefined 覆盖掉默认的 60s,
    // isStaleByTime 又把 undefined 兜成 0 ⇒ 挂载即 stale, 每次整页加载都把已经内联在
    // HTML 里的正文白拉一遍, 而三元两个分支效果相同(新鲜度机制成死代码) —— 之前这里
    // 的注释断言「对得上就别白发请求」, 实际正好相反, 是这个 bug 本身在说反话。
    ...(staleSsrLocale ? { staleTime: 0 } : {}),
  });
  /**
   * 服务端刻意不看 react-query 的缓存, 只认 loader 刚从 D1 读出来的那份。
   *
   * 历史上 root-provider 的 queryClient 是模块级单例, 在 Worker isolate 内跨请求
   * 共享, 曾导致第一次 SSR 写进去的 initialData 被后续所有请求读到(改库后必须重启
   * 进程才变)。单例已改为每请求新建, 这里保留直读 loader 作为第二道防线, 并保证
   * 两侧第一帧同源。
   *
   * 客户端第一帧走的是同一份数据(initialData 就是 loader 那份, 且这个查询没有被
   * dehydrate 到 HTML 里), 所以两侧结构一致, 不会 hydration 不匹配。
   */
  const data = import.meta.env.SSR ? loaderData.ssrData : query.data;

  const papers = data?.papers ?? [];
  // 登录态口径 / 登录回跳 / 「我的投票」批量取都在 hook 里, 三个页面共用
  const { feedbackAuth, signInCallbackURL, myVoteByPaperId } = usePaperFeedback(
    papers.map((p) => p.id),
  );
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        // 必须按 UTC 格化 —— 与刊头(edition-masthead.tsx)、往期列表
        // (past-editions.tsx)同一个理由: 周期边界是 UTC 的 00:00:00 / 23:59:59,
        // 永久链接 /gallery/w/<date> 里的日期也是 date(period_end, 'unixepoch')
        // 取的 UTC 日。按本地时区渲染会让东八区读者看到「8/9 – 8/16」, 但这一期
        // 自己的永久链接却写着 2026-08-15, 同一期出现两个日历(还会在 SSR 是 UTC
        // 时区的部署环境下变成一次 hydration mismatch, 因为服务端与客户端时区
        // 不同)。
        timeZone: "UTC",
      }),
    [locale],
  );

  // 这几条的顺序有讲究(都放在所有 hook 之后, 免得抛出那次渲染的 hook 数量对不上):
  //
  // 1. SSR 读失败 → 照实说「没读出来」。必须排在 data === null 之前: 此时 ssrData
  //    也是 null, 落到下面那条就会把一次故障说成「这期不存在」, 还顺手回 404 状态码。
  //    服务端与客户端首帧都走这里(ssrFailed 是 loader 数据, 两侧一致), 客户端那次
  //    查询回来后正文会自己补上。
  if (loaderData.ssrFailed && !data)
    return <IssueLoadFailed onRetry={() => query.refetch()} />;
  // 2. 查询出错但手里还有正文(refetch 失败 —— react-query 保留上一次的 data, 只把
  //    status 翻成 error)时, 必须继续渲染正文, 不能拿失败面板把好内容盖掉。这条最容易
  //    踩: 非英文读者每次首屏都会因为 staleSsrLocale 被强制重取一次, 那一次网络抖动
  //    就会让整篇文章消失, 而 retry 用尽 + refetchOnWindowFocus:false 意味着不刷新
  //    就再也回不来。只有「一个字都没有」时才是真的加载失败。
  if (query.isError && !data)
    return <IssueLoadFailed onRetry={() => query.refetch()} />;
  // 3. 查询明确返回 null = 这期不存在或未发布。loader 已经拦过一次, 这里兜的是
  //    loader 之后这期刚被撤下。
  if (data === null) throw notFound();
  if (!data) return <IssueSkeleton />;

  const period = dateFormat.formatRange(
    new Date(data.periodStart),
    new Date(data.periodEnd),
  );

  return (
    <main className="min-h-screen bg-[var(--bg)] py-8">
      <div className="page-wrap max-w-3xl">
        <article className="rise-in">
          {/* 刊头一行, 与方向页那张简报卡同一套语法: 栏目(可点回方向页) → 期号 →
              细线 → 覆盖周期。期号和周期是读者真正要扫的两个数, 给它们一条独立的线。 */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <Link
              to="/gallery/d/$slug"
              params={{ slug }}
              // exact 是必须的: 默认前缀匹配会把方向页这条链接在本页判成 active,
              // Link 于是给一个指向别处的链接挂上 aria-current="page"。
              activeOptions={{ exact: true }}
              className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--academic-brown)] no-underline transition-colors hover:text-[var(--academic-brown-deep)]"
            >
              {data.directionName}
            </Link>
            <span className="shrink-0 rounded-full border border-[var(--gold)]/60 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--academic-brown-deep)]">
              {m.digest_issue_n({ n: String(data.issueNumber) })}
            </span>
            <span
              aria-hidden
              className="h-px min-w-2 flex-1 bg-[var(--academic-brown)]/20"
            />
            <span className="shrink-0 text-xs text-[var(--ink-soft)]">
              {period}
            </span>
          </div>

          <h1 className="mt-3 font-serif text-3xl font-bold leading-tight text-[var(--ink)] sm:text-4xl">
            {data.title}
          </h1>

          {data.content ? (
            // 正文里的小标题跟着刊头/大标题一起用衬线: .prose 默认继承正文无衬线,
            // 否则同一页上「本期看点」是无衬线、下面「本期论文」是衬线, 像两套系统。
            // typography 插件的 `.prose :where(h2)` 是零特异性, 这里的后代选择器盖得住。
            <div className="prose prose-sm mt-6 max-w-none break-words text-[var(--ink)] [&_h1]:font-serif [&_h2]:font-serif [&_h3]:font-serif">
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                components={MARKDOWN_COMPONENTS}
              >
                {data.content}
              </ReactMarkdown>
            </div>
          ) : null}

          {papers.length > 0 ? (
            <section className="mt-12">
              <h2 className="font-serif text-xl font-semibold text-[var(--ink)]">
                {m.digest_papers_heading()}
              </h2>
              {/* <ol> 而不是 <ul>: rank 是编辑排序, 顺序本身带信息 */}
              <ol className="mt-5 space-y-5">
                {papers.map((paper) => (
                  <DigestPaperCard
                    key={paper.id}
                    paper={paper}
                    myVote={myVoteByPaperId.get(paper.id)}
                    auth={feedbackAuth}
                    signInCallbackURL={signInCallbackURL}
                  />
                ))}
              </ol>
            </section>
          ) : null}

          <nav className="mt-14 flex items-center justify-between gap-4 border-t border-[var(--line)] pt-6 text-sm">
            <div className="min-w-0 flex-1">
              {data.prevIssue !== null ? (
                <Link
                  to="/gallery/d/$slug/$issue"
                  params={{ slug, issue: String(data.prevIssue) }}
                  className="group inline-flex items-center gap-1.5 text-[var(--ink-soft)] no-underline transition-colors hover:text-[var(--academic-brown)]"
                >
                  <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
                  {m.digest_prev_issue()}
                </Link>
              ) : null}
            </div>
            <Link
              to="/gallery/d/$slug"
              params={{ slug }}
              activeOptions={{ exact: true }}
              className="shrink-0 text-[var(--academic-brown)] no-underline hover:underline"
            >
              {m.digest_back_to_direction()}
            </Link>
            <div className="flex min-w-0 flex-1 justify-end">
              {data.nextIssue !== null ? (
                <Link
                  to="/gallery/d/$slug/$issue"
                  params={{ slug, issue: String(data.nextIssue) }}
                  className="group inline-flex items-center gap-1.5 text-[var(--ink-soft)] no-underline transition-colors hover:text-[var(--academic-brown)]"
                >
                  {m.digest_next_issue()}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              ) : null}
            </div>
          </nav>
        </article>
      </div>
    </main>
  );
}

/**
 * 「这次没读出来」。用全站共用的 LoadFailedPanel(实线边 + 必填重试按钮), 与方向页
 * 空态卡的虚线边区分开: 虚线 = 内容还没生成, 实线 = 内容应该在但这次没取到。文案也
 * 不与 404 共用。
 *
 * onRetry 由调用方传入(该页 query.refetch(), 或路由错误边界的 router.invalidate())
 * —— 这个组件本身拿不到 query, 之前那版无参组件正是 #34 的病根: 文案写着「请重试」,
 * 页面上却没有任何可点的东西。
 *
 * 不直接把 LoadFailedPanel 塞进旧版 IssuePanel 的边框盒子里: 那个盒子自己也有一圈
 * border, 两层描边框叠在一起是视觉噪音, 所以这里改用无边框的 IssuePanelShell, 边框
 * 只留 LoadFailedPanel 自己那一层, 「返回该方向」链接另起一行放在盒子外面。
 */
function IssueLoadFailed({ onRetry }: { onRetry: () => void }) {
  const { slug } = Route.useParams();
  return (
    <IssuePanelShell>
      <LoadFailedPanel
        message={m.digest_issue_load_failed()}
        onRetry={onRetry}
      />
      <div className="mt-5 flex justify-center">
        <Link
          to="/gallery/d/$slug"
          params={{ slug }}
          activeOptions={{ exact: true }}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--academic-brown)] no-underline hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {m.digest_back_to_direction()}
        </Link>
      </div>
    </IssuePanelShell>
  );
}

/**
 * 路由级错误边界(loader 抛出的非 notFound 故障, 多半是客户端导航时 ensureQueryData
 * 网络失败)。TanStack 注入的是 {error, info, reset}, 不是页面内那份 query, 所以借
 * router.invalidate() 重跑 loader 当重试动作, 与 /gallery/w/$period 的
 * EditionRouteError 同一处理。
 */
function IssueRouteError() {
  const router = useRouter();
  return <IssueLoadFailed onRetry={() => router.invalidate()} />;
}

/** 期号不存在 / 这期还没发布(或已撤下)。 */
function IssueNotFound() {
  const { slug } = Route.useParams();
  return (
    <IssuePanelShell>
      <div className="rise-in rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-6 text-center">
        <h1 className="font-serif text-2xl font-bold text-[var(--ink)]">404</h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          {m.digest_issue_not_found()}
        </p>
        <Link
          to="/gallery/d/$slug"
          params={{ slug }}
          activeOptions={{ exact: true }}
          className="mt-5 inline-flex items-center gap-1.5 text-sm text-[var(--academic-brown)] no-underline hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {m.digest_back_to_direction()}
        </Link>
      </div>
    </IssuePanelShell>
  );
}

function IssuePanelShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--bg)] py-8">
      <div className="page-wrap max-w-3xl">{children}</div>
    </main>
  );
}

function IssueSkeleton() {
  return (
    <main className="min-h-screen bg-[var(--bg)] py-8">
      <div className="page-wrap max-w-3xl">
        <Skeleton className="h-3 w-56" />
        <Skeleton className="mt-4 h-10 w-4/5" />
        <div className="mt-6 space-y-2.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton className="mt-12 h-6 w-40" />
        <div className="mt-5 space-y-5">
          <Skeleton className="h-36 w-full rounded-2xl" />
          <Skeleton className="h-36 w-full rounded-2xl" />
        </div>
      </div>
    </main>
  );
}
