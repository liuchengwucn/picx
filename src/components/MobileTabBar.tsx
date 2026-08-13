import { Link } from "@tanstack/react-router";
import { FileText, Globe, Home, Newspaper, Sparkles } from "lucide-react";
import { m } from "#/paraglide/messages";

// 小屏底部 Tab 栏, md 以上隐藏(与 Header 导航组互斥切换)。
// 首页 Tab 需 exact, 否则任何路由都命中 "/" 前缀而常亮。
const ITEM_CLASS =
  "tab-link flex flex-1 flex-col items-center gap-0.5 py-2 no-underline";

export default function MobileTabBar() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--line)] bg-[var(--header-bg)] pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
      aria-label={m.nav_aria_tabbar()}
    >
      <div className="flex items-stretch">
        <Link
          to="/"
          className={ITEM_CLASS}
          activeOptions={{ exact: true }}
          activeProps={{ className: `${ITEM_CLASS} is-active` }}
        >
          <Home className="h-5 w-5" />
          <span className="text-[10px] font-medium leading-none whitespace-nowrap">
            {m.nav_home()}
          </span>
        </Link>
        <Link
          to="/gallery"
          className={ITEM_CLASS}
          activeProps={{ className: `${ITEM_CLASS} is-active` }}
        >
          <Globe className="h-5 w-5" />
          <span className="text-[10px] font-medium leading-none whitespace-nowrap">
            {m.nav_gallery()}
          </span>
        </Link>
        <Link
          to="/news"
          className={ITEM_CLASS}
          activeProps={{ className: `${ITEM_CLASS} is-active` }}
        >
          <Newspaper className="h-5 w-5" />
          <span className="text-[10px] font-medium leading-none whitespace-nowrap">
            {m.nav_news()}
          </span>
        </Link>
        <Link
          to="/papers"
          className={ITEM_CLASS}
          activeProps={{ className: `${ITEM_CLASS} is-active` }}
        >
          <FileText className="h-5 w-5" />
          <span className="text-[10px] font-medium leading-none whitespace-nowrap">
            {m.nav_papers()}
          </span>
        </Link>
        <Link
          to="/assistant"
          className={ITEM_CLASS}
          activeProps={{ className: `${ITEM_CLASS} is-active` }}
        >
          <Sparkles className="h-5 w-5" />
          <span className="text-[10px] font-medium leading-none whitespace-nowrap">
            {m.nav_assistant()}
          </span>
        </Link>
      </div>
    </nav>
  );
}
