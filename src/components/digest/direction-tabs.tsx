import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
 * 方向导航行。是导航(点了跳方向主页)而不是筛选器, 所以不写进 /gallery 的 search
 * params, 也不跟着筛选栏 sticky。/gallery 与方向主页共用。
 *
 * 与 /gallery 页做 slug→方向名 映射的那次查询是同一个 query key, react-query 会
 * 去重, 不会多发一次请求。
 */
export function DirectionTabs({ activeSlug }: DirectionTabsProps) {
  const trpc = useTRPC();
  const { data, isPending } = useQuery({
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
  if (directions.length === 0 && !isPending) return null;

  return (
    <nav
      aria-label={m.digest_directions_nav()}
      className="mb-2 border-b border-[var(--line)]"
    >
      {/* -mb-px 挂在滚动容器自己身上(不是挂在 tab 上): 让当前项那道 2px 下划线盖住
          上面这条 hairline, 又不会让横向滚动容器凭空多出 1px 纵向溢出 */}
      <div className="-mb-px flex items-center gap-5 overflow-x-auto px-1 text-sm">
        <Link
          to="/gallery"
          aria-current={activeSlug ? undefined : "page"}
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
              aria-current={active ? "page" : undefined}
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
