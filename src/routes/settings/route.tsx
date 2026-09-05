import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { SettingsListSkeleton } from "#/components/settings/settings-primitives";
import { Skeleton } from "#/components/ui/skeleton";
import { useHydrated } from "#/hooks/use-hydrated";
import { useRequireAuth } from "#/hooks/use-require-auth";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/settings")({
  component: SettingsLayout,
});

// label 是 thunk 而不是字符串：模块作用域求值会把语言钉死在模块加载那一刻，
// 切语言后导航仍是旧语言。必须推迟到渲染时再调 m.*。
const NAV_ITEMS = [
  { to: "/settings/account", label: () => m.settings_nav_account() },
  { to: "/settings/providers", label: () => m.settings_nav_providers() },
  { to: "/settings/prompts", label: () => m.settings_nav_prompts() },
] as const;

/**
 * 设置页布局：标题 + 左栏子导航（移动端折成一行 chip）+ 子页。
 *
 * 登录门在这里过一次，子页不再各自 useRequireAuth。首帧按既定模式：hydration 未完成
 * 或 session 未确定时渲染中性骨架，确定未登录时 useRequireAuth 已经在跳 OAuth，这里
 * 继续渲染骨架而不是 null（避免整页闪白）。
 *
 * 子导航三个目标都是叶子路由，Link 默认的前缀匹配在这里等价于精确匹配；仍显式
 * exact 是为了不给「/settings 也 active」留口子。aria-current 由 Link 自己挂，
 * 整页因此只会有一个 aria-current="page"（Header 不含设置项）。
 */
function SettingsLayout() {
  const { session, isSessionPending } = useRequireAuth("/settings");
  const hydrated = useHydrated();
  const resolved = hydrated && !isSessionPending;

  return (
    <main className="page-wrap py-8 sm:py-10">
      <h1 className="font-serif text-2xl font-bold tracking-tight text-[var(--ink)]">
        {m.settings_title()}
      </h1>
      <div className="mt-6 flex flex-col gap-6 md:flex-row md:gap-10">
        {/* -mx-1 + px-1 成对出现是为了让 chip 的 focus ring 不被 overflow-x-auto
            的滚动容器裁掉；md: 起两者都归零。w-48 是按最长的日文标签
            「ホワイトボードテンプレート」量的，w-44 会溢出。 */}
        <nav
          aria-label={m.settings_nav_aria()}
          className="-mx-1 flex gap-2 overflow-x-auto px-1 md:mx-0 md:w-48 md:flex-none md:flex-col md:gap-0.5 md:overflow-visible md:px-0"
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: true }}
              // 颜色一律挂在内层 span：styles.css 里未分层的 a{color} 会盖掉 <a> 上的 text-*
              className="group whitespace-nowrap rounded-full border border-transparent px-2.5 py-0.5 text-xs no-underline data-[status=active]:border-[var(--academic-brown)]/30 data-[status=active]:bg-[var(--academic-brown)]/8 md:rounded-none md:border-0 md:px-0 md:py-1.5 md:text-sm md:data-[status=active]:bg-transparent"
            >
              <span className="text-[var(--ink-soft)] transition-colors group-hover:text-[var(--ink)] group-data-[status=active]:text-[var(--academic-brown)] md:group-data-[status=active]:font-semibold md:group-data-[status=active]:text-[var(--ink)]">
                {item.label()}
              </span>
            </Link>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {resolved && session ? (
            <Outlet />
          ) : (
            <div>
              <Skeleton className="h-3 w-24" />
              {/* SettingsListSkeleton 只吐 <li>，独立使用时由调用方套 <ul> */}
              <ul className="mt-3 list-none p-0">
                <SettingsListSkeleton />
              </ul>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
