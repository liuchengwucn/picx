import { useQuery } from "@tanstack/react-query";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { useTRPC } from "#/integrations/trpc/react";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

interface DirectionTabsProps {
  /** undefined = /gallery「全部」高亮 */
  activeSlug?: string;
}

const tabClassName = (active: boolean) =>
  cn(
    "shrink-0 whitespace-nowrap border-b-2 pt-1 pb-2 no-underline transition-colors",
    active
      ? "border-[var(--academic-brown)] font-semibold text-[var(--ink)]"
      : "border-transparent text-[var(--ink-soft)] hover:text-[var(--ink)]",
  );

/**
 * 方向导航行。是导航(点了跳方向主页)而不是筛选器, 所以不写进 search params, 也不跟着
 * 筛选栏 sticky。
 *
 * 今天唯一的挂载点是方向主页(/gallery/d/$slug.tsx), 且总传 activeSlug —— /gallery 自
 * 周刊重构后是刊物落地页, 用的是竖脊(EditionSpine)而不是这行 tab; 单期页也还没复用它。
 * 组件仍然按「可以被别的页面挂载」写(见下面 onGalleryRoot / onDirectionRoot 两个判据),
 * 那是留给将来复用的接缝, 不是当下在防的东西。
 *
 * 与方向主页自己那次 slug→方向名 映射查询是同一个 query key, react-query 会去重,
 * 不会多发一次请求。
 */
export function DirectionTabs({ activeSlug }: DirectionTabsProps) {
  const trpc = useTRPC();
  const matchRoute = useMatchRoute();
  // 两个判据都是 fuzzy:false 的精确匹配, 回答的是同一个问题: 「读屏该不该把这一项念成
  // 当前页」。视觉高亮另走 activeSlug, 两者刻意不同源。
  //
  // onDirectionRoot: 只有真的停在 /gallery/d/$slug 上方向 tab 才配 aria-current。
  // 将来把这行挂到单期页(/gallery/d/$slug/$issue)时, 这里的精确匹配会失败(路径段更长),
  // tab 不会冒领「当前页」—— 那是这个判据存在的理由, 今天还没有这个挂载点。
  //
  // onGalleryRoot: 同理给「全部」那一项。今天它恒为 false(唯一挂载点是方向页), 所以
  // 「全部」永远拿不到 aria-current —— 这是对的, 一并保证了将来这行被挂到 /gallery 上
  // 时不必再回来改一遍。别把它简化成 !activeSlug: 那个值与当前路由无关, 任何传
  // activeSlug=undefined 的挂载点都会让「全部」在一个不是 /gallery 的页面上自称当前页。
  const onDirectionRoot = Boolean(
    matchRoute({ to: "/gallery/d/$slug", fuzzy: false }),
  );
  const onGalleryRoot = Boolean(matchRoute({ to: "/gallery", fuzzy: false }));
  const { data, isPending, isError } = useQuery({
    ...trpc.digest.listDirections.queryOptions({ locale: getLocale() }),
    // 方向列表一周才动一次, 页面间来回切不必重取
    staleTime: 5 * 60_000,
  });
  const directions = data ?? [];
  // 一个在跟踪的方向都没有(部署初期 seed 未跑)时整行不渲染, 免得留一条只有
  // 「全部」的空导航。
  // 但取数期间要照常渲染只有「全部」的那一行: 方向列表是客户端取的, 加载期间返回
  // null 会让整行 34px 在 hydration 后凭空插入, 把下面的筛选栏/内容一起推下去。
  // 「全部」不依赖数据, 先占住这一行, 方向 tab 到货后只在横向追加, 纵向零位移。
  //
  // 代价是把位移挪给了「零方向」这一种部署: 那时先出现一行再消失(改动前它全程不闪)。
  // 这么换是因为零方向只是 seed 跑起来之前的过渡态, 而有方向是长期稳态。
  //
  // isError 必须与「零方向」分开: 取数失败时 data 是 undefined、isPending 已是 false,
  // 落进上面那条空态就等于一次瞬时失败把整行导航抹掉(还连带把下面内容上移)。
  // 而 listDirections 与本页另外两条查询在同一个 tRPC batch 里, 一条失败就是三条一起
  // 失败, 这条路径比看着容易走到。失败就降级成只有「全部」的那一行: 布局不动, 用户
  // 也还能回到 /gallery。整行不渲染只留给「取数成功但确实没有 active 方向」。
  if (directions.length === 0 && !isPending && !isError) return null;

  return (
    <nav
      aria-label={m.digest_directions_nav()}
      className="mb-2 border-b border-[var(--line)]"
    >
      {/* -mb-px 挂在滚动容器自己身上(不是挂在 tab 上): 让当前项那道 2px 下划线盖住
          上面这条 hairline, 又不会让横向滚动容器凭空多出 1px 纵向溢出 */}
      <div className="-mb-px flex items-center gap-5 overflow-x-auto px-1 text-sm">
        {/* activeOptions exact 不是可选项: Link 默认按前缀判 active, 于是在
            /gallery/d/formal-math 上「全部」(/gallery)也算 active、在期页上方向 tab
            也算 active。但即便 exact 挡住了大多数误判, TanStack 的
            STATIC_ACTIVE_PROPS 是在用户 props 之后展开的(见 link.js 的
            `...isActive && STATIC_ACTIVE_PROPS`), 一旦它判定的 isActive 为 true,
            aria-current="page" 会覆盖掉我们显式传的值, 挡不住。所以两项的
            aria-current 都不能只靠 activeOptions, 得用 useMatchRoute 精确算出
            「是否真的停在那个页面上」(onGalleryRoot / onDirectionRoot), 再与
            activeSlug 一起判定。视觉高亮(tabClassName)仍然只看 activeSlug, 与
            aria-current 的语义判定分开: 前者是「用户选了哪个方向」, 后者是
            「读屏该不该念这是当前页」。 */}
        <Link
          to="/gallery"
          activeOptions={{ exact: true }}
          aria-current={!activeSlug && onGalleryRoot ? "page" : undefined}
          className={tabClassName(!activeSlug)}
        >
          {m.digest_direction_all()}
        </Link>
        {directions.map((direction) => {
          const active = activeSlug === direction.slug;
          return (
            <Link
              key={direction.slug}
              to="/gallery/d/$slug"
              params={{ slug: direction.slug }}
              activeOptions={{ exact: true }}
              aria-current={onDirectionRoot && active ? "page" : undefined}
              className={tabClassName(active)}
            >
              {direction.name}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
