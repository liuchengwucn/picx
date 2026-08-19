import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { EditionSkeleton } from "#/components/digest/edition-skeleton";
import {
  EditionPanelShell,
  EditionView,
} from "#/components/digest/edition-view";
import {
  PastEditions,
  selectPastEditions,
} from "#/components/digest/past-editions";
import {
  LoadFailedPanel,
  PanelLinkContent,
  PendingPanel,
  panelLinkClass,
} from "#/components/ui/state-panel";
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
 * 落地页已经不收任何筛选参数了(检索搬去了 /gallery/archive), 但这批键必须**留在
 * schema 里**: 非 strict 的 zod 会把未知键静默抹掉, beforeLoad 里就再也看不到它们,
 * 于是老书签 /gallery?q=lean&cat=llm 重定向过去时筛选条件全丢。
 * 键集与 archive.tsx 的那份一致(除 dir —— 那是档案页新增的轴, 老链接里不会有)。
 */
const legacySearchSchema = z.object({
  q: z.string().optional(),
  cat: z.string().optional(),
  tag: z.string().optional(),
  sort: z.enum(["recent", "popular"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const Route = createFileRoute("/gallery/")({
  validateSearch: legacySearchSchema,
  beforeLoad: ({ search }) => {
    if (search.q || search.cat || search.tag || search.sort || search.page) {
      throw redirect({
        to: "/gallery/archive",
        // 原样带上全部参数, 一个不丢
        search,
        // 必须是**临时**重定向: 301 会被浏览器永久缓存, 将来档案路径若再变, 已经
        // 访问过的浏览器就再也救不回来了
        statusCode: 302,
        replace: true,
      });
    }
  },
  /**
   * 页内锚点点击(竖脊末尾那条「往期合刊」是裸 <a href="#past-editions">, 走浏览器
   * 默认跳转)会改 URL hash, 而 @tanstack/history 把它当成一次导航 —— 实测每点一次
   * 就多跑一遍本路由的 loader(在客户端那是一次真实的数据请求)。本路由的 loader
   * 不依赖任何 params/search, 同一个 URL 重进没有任何理由重跑。
   *
   * 方向 chips 那批锚点走的是 useScrollSpy 的 jumpTo(刻意不写 hash), 不受影响;
   * 但「不写 hash」这个约定只能管住 JS 接管的链接, 所以这一层仍然要有。
   */
  shouldReload: false,
  loader: async ({ context }) => {
    // 落地页是站点主入口, 正文必须进第一个 HTML 响应(SEO + 首屏)。服务端不能走
    // tRPC client: 它在 SSR 侧指向 localhost, 部署到 Workers 里发不出去 —— 与
    // /p、/news、单期页同一处理: 直读 D1。
    if (import.meta.env.SSR) {
      const localeKey = normalizeLocaleKey(getLocale());
      try {
        const { env } = await import("cloudflare:workers");
        const { drizzle } = await import("drizzle-orm/d1");
        // 动态 import: edition-store 拽进 drizzle-orm 与整份 schema, 静态引会把它们
        // 打进客户端包
        const {
          getEditionByPeriod,
          listDirectionColorInputs,
          listEditionPeriods,
        } = await import("#/lib/digest/edition-store");
        const db = drizzle((env as typeof env & AppEnvBindings).DB);
        // 三条互不依赖, 并成一批而不是三次串行往返
        const [edition, periods, directions] = await Promise.all([
          getEditionByPeriod(db, null),
          listEditionPeriods(db),
          listDirectionColorInputs(db),
        ]);
        return {
          ssrData: edition ? mapEditionToLocale(edition, localeKey) : null,
          ssrPeriods: periods,
          // 方向色输入也必须走 SSR: 少了它服务端只能按本期栏目分配色相, 客户端拿到
          // 全量方向后分配结果不同 —— 栏眉方块的 inline style 对不上就是一处
          // hydration mismatch(压缩构建里只报 #418, 极难定位)。
          ssrDirections: directions,
          ssrLocaleKey: localeKey,
          // 与 ssrData: null 区分「读到了, 确实一期都没有」和「这一帧不是 SSR 读的」
          ssrRead: true,
          ssrFailed: false,
        };
      } catch (error) {
        // 降级为纯 CSR(客户端那次查询能把正文补回来), 但故障不能无声无息:
        // 三态口径要求读失败照实说, 既不许说成「生成中」, 也不许回 404。
        console.error("[gallery edition loader] SSR D1 read failed", error);
        return {
          ssrData: null,
          ssrPeriods: null,
          ssrDirections: null,
          ssrLocaleKey: null,
          ssrRead: false,
          ssrFailed: true,
        };
      }
    }
    // 客户端导航。用 prefetchQuery 而不是 ensureQueryData: 两者都会把数据填进
    // 缓存, 但 prefetch 不抛 —— 取数失败要落到组件里的失败面板(带重试), 而不是
    // 冒到路由错误边界; 落地页的「一期都没有」也是正常态而不是需要在 loader 里
    // 提前拦下的 404。
    //
    // 方向色输入也一起等: 少了它色相只能按「本期栏目」这个小集合分配, 等
    // listDirections 到位再按全量方向重算, 读者看到的是栏眉方块当场换色。
    //
    // listEditionPeriods 同样要等: 它是页尾往期列表 + 脊上「往期合刊」锚点的判据,
    // 少了它客户端跳进 /gallery 的首帧 periods=[], 那条锚点会晚一拍才弹出来。
    await Promise.all([
      context.queryClient.prefetchQuery(
        context.trpc.digest.getEdition.queryOptions({ locale: getLocale() }),
      ),
      context.queryClient.prefetchQuery(
        context.trpc.digest.listDirections.queryOptions({
          locale: getLocale(),
        }),
      ),
      context.queryClient.prefetchQuery(
        context.trpc.digest.listEditionPeriods.queryOptions(),
      ),
    ]);
    return {
      ssrData: null,
      ssrPeriods: null,
      ssrDirections: null,
      ssrLocaleKey: null,
      ssrRead: false,
      ssrFailed: false,
    };
  },
  component: WeeklyGalleryPage,
  head: ({ loaderData }) => {
    // D1 读失败的那一帧没有正文, 只有一块失败面板 —— 不执行 JS 的抓取方看到的是个
    // 软 404, 发自指 canonical 等于主动请求把带错误信息的空页收录成 /gallery 的
    // 权威版本。这一帧只在 D1 抛错时存在, 那意味着全站同时在失败、其余路由
    // (/p/$shortId、/news/$shortId、gallery/d、w.$period)**已经**在发 noindex,
    // 所以这里不例外才是一致的。
    //
    // 只按 ssrFailed 判: ssrData === null 的「首期合刊生成中」是**真内容**(读成功了,
    // 确实一期都没有), 该照常可收录、照常发自指 canonical。
    if (loaderData?.ssrFailed) {
      return {
        meta: [
          // 与 w.$period 的失败帧同一个标题: 两处是同一件事(这一期没读出来)。
          // gallery_load_failed 是面板里那句完整的话, 当标题太长。
          { title: `${m.digest_issue_error_title()} | PicX` },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const title = m.page_title_gallery();
    const description = m.edition_meta_description();
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: `${SITE_URL}/gallery` },
      ],
      // 有正文时永远自指: 落地页是品牌入口。本周那一期同时住在 /gallery/w/<latest>,
      // 让位的是那一边(见 w.$period.tsx 的 isLatest 条件 canonical)。
      links: [{ rel: "canonical", href: `${SITE_URL}/gallery` }],
    };
  },
});

function WeeklyGalleryPage() {
  const loaderData = Route.useLoaderData();
  const trpc = useTRPC();
  const locale = getLocale();
  const localeKey = normalizeLocaleKey(locale);

  // 「读到了, 但一期都没有」(null)也要当 initialData 喂进去, 不能折成 undefined:
  // 否则 SSR 渲染的是 PendingPanel、客户端第一帧因为 data 还是 undefined 渲染骨架,
  // 又是一处 hydration mismatch。ssrRead 就是为了把它与「这一帧不是 SSR 读的」
  // 分开(客户端导航时 ssrData 也是 null, 那种 null 不能当答案用)。
  const ssrInitialData = loaderData.ssrRead ? loaderData.ssrData : undefined;
  // SSR 那份是按服务端解析出的 locale 渲染的(cookie → Accept-Language → baseLocale)。
  // 对不上当前 locale 时必须立刻重取, 否则 root-provider 的默认 staleTime(60s)会把
  // 另一种语言的正文按住一分钟 —— 与单期页同一处理。
  const staleSsrLocale =
    ssrInitialData !== undefined && loaderData.ssrLocaleKey !== localeKey;
  const query = useQuery({
    ...trpc.digest.getEdition.queryOptions({ locale }),
    initialData: ssrInitialData,
    // 只在语言对不上时压掉 staleTime; 平时这个键**根本不出现**, 把新鲜度留给
    // queryClient 的默认值(root-provider 的 60s)。
    //
    // 不能写成 `staleTime: staleSsrLocale ? 0 : undefined`: useQuery 的选项是
    // `{...defaults.queries, ...options}` 展开合并, 显式的 undefined 会**覆盖**默认值,
    // 而 isStaleByTime 再把 undefined 兜成 0 ⇒ 查询挂载即 stale、refetchOnMount 触发,
    // 于是每次整页加载都把已经内联在 HTML 里的正文再拉一遍(英文约 9.9KB, CJK 更多),
    // 三元的两个分支效果还完全相同(整套语言新鲜度机制变成死代码)。
    ...(staleSsrLocale ? { staleTime: 0 } : {}),
  });
  const periodsQuery = useQuery({
    ...trpc.digest.listEditionPeriods.queryOptions(),
    staleTime: 5 * 60_000,
  });
  // 与档案页 / 方向页共用同一个 query key, react-query 去重, 不会多发一次请求
  const directionsQuery = useQuery({
    ...trpc.digest.listDirections.queryOptions({ locale }),
    staleTime: 5 * 60_000,
  });

  /**
   * 服务端刻意不看 react-query 缓存, 只认 loader 刚从 D1 读出来的那份: 历史上
   * root-provider 的 queryClient 是模块级单例、在 Worker isolate 内跨请求共享,
   * 第一次 SSR 写进去的 initialData 会被后续所有请求读到。单例已改成每请求新建,
   * 这里是第二道防线, 同时保证两侧第一帧同源。
   */
  const data = import.meta.env.SSR ? loaderData.ssrData : query.data;
  // 客户端第一帧这两个 query 还没数据, 必须回退到 loader 那份, 否则脊上的方向色与
  // 页尾往期列表两侧不一致(同样是 hydration mismatch)
  const allDirections = directionsQuery.data ?? loaderData.ssrDirections ?? [];
  const periods = periodsQuery.data ?? loaderData.ssrPeriods ?? [];

  // 以下几条的顺序有讲究, 且都在所有 hook 之后(免得提前 return 那次渲染的 hook
  // 数量对不上)。
  //
  // 1. SSR 读失败 → 照实说「没读出来」。判据必须是 `!data` 而不是
  //    `data === undefined`: 服务端的 data 取自 loaderData.ssrData, 那一帧它是
  //    **null**, 用 === undefined 就漏判, 于是这一帧落到第 3 条, 把一次读故障说成
  //    「首期合刊生成中」—— 正是三态口径明令禁止的那句谎话(单期页那边同一个坑
  //    更凶: 会直接渲染成 404)。这条必须排在 data === null 之前。
  if (loaderData.ssrFailed && !data) {
    return (
      <EditionPanelShell>
        <LoadFailedPanel onRetry={() => query.refetch()} />
      </EditionPanelShell>
    );
  }
  // 2. 手里还有正文时不能拿失败面板盖掉好内容: 非默认语言的读者每次首屏都会因
  //    staleSsrLocale 被强制重取一次, 那一次网络抖动若直接翻成失败面板, 整期正文就
  //    消失了, 而 retry 用尽 + refetchOnWindowFocus:false 意味着不刷新再也回不来。
  if (query.isError && !data) {
    return (
      <EditionPanelShell>
        <LoadFailedPanel onRetry={() => query.refetch()} />
      </EditionPanelShell>
    );
  }
  // 3. 全站一期都还没发布。不是 404 也不是空白页 —— 照实说在生成, 并给出唯一还能读
  //    的去处(档案里有 900+ 篇论文)。
  if (data === null) {
    return (
      <EditionPanelShell>
        <PendingPanel
          message={m.edition_empty()}
          action={
            <Link
              to="/gallery/archive"
              activeOptions={{ exact: true }}
              className={panelLinkClass}
            >
              <PanelLinkContent>{m.archive_title()}</PanelLinkContent>
            </Link>
          }
        />
      </EditionPanelShell>
    );
  }
  // 4. 一个字都还没有 = 还在取(前三条已经把 null 全部消化掉了)
  if (!data) {
    return (
      <main className="min-h-dvh bg-[var(--bg)] py-8">
        <EditionSkeleton />
      </main>
    );
  }

  // 脊上「往期合刊」那条锚点的判据: 页尾那节里真的有往期才出。第一周(七个方向首期
  // 共享同一个 period_end, listEditionPeriods 只返回一期)过滤完是空的, 那时不能给锚点。
  // 与 <PastEditions> 走同一个 selectPastEditions, 两者不会各说各话。
  const hasPastEditions = selectPastEditions(periods, data.period).length > 0;

  return (
    <main className="min-h-dvh bg-[var(--bg)] py-8">
      <EditionView
        edition={data}
        allDirections={allDirections}
        showPastAnchor={hasPastEditions}
      >
        <PastEditions editions={periods} currentPeriod={data.period} />
      </EditionView>
    </main>
  );
}
