import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  isNotFound,
  notFound,
  useRouter,
} from "@tanstack/react-router";
import { EditionSkeleton } from "#/components/digest/edition-skeleton";
import { EditionView } from "#/components/digest/edition-view";
import { LoadFailedPanel } from "#/components/ui/state-panel";
import { useTRPC } from "#/integrations/trpc/react";
import { mapEditionToLocale } from "#/lib/digest/present";
import { SITE_URL } from "#/lib/site-url";
import { normalizeLocaleKey } from "#/lib/tldr";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

interface AppEnvBindings {
  DB: D1Database;
}

/**
 * $period 是 date(period_end, 'unixepoch') 那个 UTC 日期字符串。校验原始字符串(而
 * 不是 Date 解析结果): 松一点就会让同一期从无数个地址打开(canonical 只能收敛索引,
 * 挡不住每个地址各渲染一遍)。格式不对一律 404, 不去查库。
 */
const PERIOD_RE = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/gallery/w/$period")({
  // 与落地页同一个理由: 页内锚点写 hash 会被 @tanstack/history 当成一次导航并重跑
  // loader。这一页的 loader 只依赖 $period, 换期是换 match(照常重跑), 同一期重进
  // 没有理由再读一次 D1。
  shouldReload: false,
  loader: async ({ context, params }) => {
    if (!PERIOD_RE.test(params.period)) throw notFound();

    if (import.meta.env.SSR) {
      // 与落地页同一处理: SSR 侧 tRPC client 指向 localhost, 在 Workers 里发不出去,
      // 所以直读 D1。永久链接是给人引用 / 给爬虫抓的地址, 正文必须在首帧 HTML 里。
      const localeKey = normalizeLocaleKey(getLocale());
      try {
        const { env } = await import("cloudflare:workers");
        const { drizzle } = await import("drizzle-orm/d1");
        const { getEditionByPeriod, listDirectionColorInputs } = await import(
          "#/lib/digest/edition-store"
        );
        const db = drizzle((env as typeof env & AppEnvBindings).DB);
        const [edition, directions] = await Promise.all([
          getEditionByPeriod(db, params.period),
          listDirectionColorInputs(db),
        ]);
        // 这一期不存在 → 真 404 状态码, 不是 200 空壳
        if (!edition) throw notFound();
        return {
          ssrData: mapEditionToLocale(edition, localeKey),
          // 全量 active 方向: 色相是先到先得占槽, 服务端若只按本期栏目分配, 客户端
          // 拿到全量后结果不同, 栏眉方块的 inline style 就是一处 hydration mismatch
          ssrDirections: directions,
          ssrLocaleKey: localeKey,
          isLatest: edition.isLatest,
          ssrFailed: false,
        };
      } catch (error) {
        // notFound 必须穿透, 否则「这期不存在」会被下面的降级分支说成「读失败」
        if (isNotFound(error)) throw error;
        // 降级为纯 CSR, 但故障不能无声无息(三态口径: 读失败不许说成 404/空态)
        console.error("[edition permalink loader] SSR D1 read failed", error);
        return {
          ssrData: null,
          ssrDirections: null,
          ssrLocaleKey: null,
          isLatest: false,
          ssrFailed: true,
        };
      }
    }

    // 客户端导航。这里必须 ensureQueryData 而不是 prefetch: 查不到就得当场
    // throw notFound(), 「这一周不存在」在客户端也要是 404 而不是一块空面板。
    // 方向色输入并行 prefetch(它取不到只是颜色退化, 不该让整页进错误边界)。
    const [data] = await Promise.all([
      context.queryClient.ensureQueryData(
        context.trpc.digest.getEdition.queryOptions({
          period: params.period,
          locale: getLocale(),
        }),
      ),
      context.queryClient.prefetchQuery(
        context.trpc.digest.listDirections.queryOptions({
          locale: getLocale(),
        }),
      ),
    ]);
    if (!data) throw notFound();
    return {
      ssrData: null,
      ssrDirections: null,
      ssrLocaleKey: null,
      isLatest: data.isLatest,
      ssrFailed: false,
    };
  },
  component: EditionPermalinkPage,
  // 客户端导航时 ensureQueryData 抛出(网络故障)会冒到这里。默认错误边界是一段
  // 通用报错, 三态口径要求失败态必须带一个能点的重试 —— invalidate 会重跑 loader。
  errorComponent: EditionRouteError,
  head: ({ loaderData, params }) => {
    // 两种没有正文的帧, 都不该进索引, 也都不发 canonical:
    // loaderData 为空 = loader 抛了 notFound(这期不存在 / 格式非法);
    // ssrFailed = D1 读失败 —— 这一帧证明不了这期存在, 不执行 JS 的抓取方看到的是
    // 一个软 404, 自指 canonical 等于主动请求收录一个空页。
    if (!loaderData || loaderData.ssrFailed) {
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

    const title = m.edition_permalink_title({ period: params.period });
    const description = m.edition_meta_description();
    // 全站同一份内容只留一个规范 URL: 本周那一期同时住在 /gallery, 让位给它;
    // 下一周到来后 isLatest 翻成 false, 这条地址自动变成自指。别写成无条件自指。
    const canonical = loaderData.isLatest
      ? `${SITE_URL}/gallery`
      : `${SITE_URL}/gallery/w/${params.period}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonical },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
});

function EditionPermalinkPage() {
  const { period } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const trpc = useTRPC();
  const locale = getLocale();
  const localeKey = normalizeLocaleKey(locale);

  const ssrData = loaderData.ssrData ?? undefined;
  // SSR 那份是按服务端解析出的 locale 渲染的; 对不上就立刻重取, 否则默认
  // staleTime(60s)会把另一种语言的正文按住一分钟(与单期页同一处理)
  const staleSsrLocale =
    ssrData !== undefined && loaderData.ssrLocaleKey !== localeKey;
  const query = useQuery({
    ...trpc.digest.getEdition.queryOptions({ period, locale }),
    initialData: ssrData,
    staleTime: staleSsrLocale ? 0 : undefined,
  });
  const directionsQuery = useQuery({
    ...trpc.digest.listDirections.queryOptions({ locale }),
    staleTime: 5 * 60_000,
  });

  // 服务端只认 loader 刚读出来的那份(queryClient 曾是跨请求单例, 这是第二道防线,
  // 也保证两侧第一帧同源)
  const data = import.meta.env.SSR ? loaderData.ssrData : query.data;
  // 客户端第一帧 directionsQuery 还没数据, 必须回退到 loader 那份, 否则栏眉/脊上
  // 的方向色两侧不一致
  const allDirections = directionsQuery.data ?? loaderData.ssrDirections ?? [];

  // 顺序有讲究, 且都在所有 hook 之后(免得抛出那次渲染的 hook 数量对不上)。
  //
  // 1. SSR 读失败 → 照实说「没读出来」。判据必须是 `!data` 而不是
  //    `data === undefined`: 服务端的 data 取自 loaderData.ssrData, 那一帧它是
  //    **null**, 用 === undefined 就漏判, 于是这一帧一路落到第 3 条 throw notFound()
  //    —— 实测服务端渲染出的是 404 页(而 head 还带着 ssrFailed 的 noindex),
  //    一次读故障被说成「这期不存在」。这条必须排在 data === null 之前。
  if (loaderData.ssrFailed && !data) {
    return <EditionPanelShell onRetry={() => query.refetch()} />;
  }
  // 2. 有正文时不能拿失败面板盖掉好内容: 非默认语言的读者每次首屏都会因
  //    staleSsrLocale 被强制重取一次, 那一次网络抖动若翻成失败面板, 整期正文就消失了,
  //    而 retry 用尽 + refetchOnWindowFocus:false 意味着不刷新再也回不来。
  if (query.isError && !data) {
    return <EditionPanelShell onRetry={() => query.refetch()} />;
  }
  // 3. loader 已经拦过一次, 这里兜的是 loader 之后这期刚被撤下
  if (data === null) throw notFound();
  // 4. 一个字都还没有 = 还在取(前三条已经把 null 全部消化掉了)
  if (!data) {
    return (
      <main className="min-h-dvh bg-[var(--bg)] py-8">
        <EditionSkeleton />
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[var(--bg)] py-8">
      {/* 不传 children: 页尾往期列表只在落地页出(单期永久链接自己就是那条稳定地址) */}
      <EditionView edition={data} allDirections={allDirections} />
    </main>
  );
}

function EditionPanelShell({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="min-h-dvh bg-[var(--bg)] py-16">
      <div className="page-wrap max-w-5xl">
        <LoadFailedPanel onRetry={onRetry} />
      </div>
    </main>
  );
}

function EditionRouteError() {
  const router = useRouter();
  return <EditionPanelShell onRetry={() => router.invalidate()} />;
}
