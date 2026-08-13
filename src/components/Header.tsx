import { Link } from "@tanstack/react-router";
import { FileText, Globe, Newspaper, Sparkles } from "lucide-react";
// 与引用分享卡右上角同一枚羊皮纸 mark(logo512 抠底版), 品牌符号全站只此一个。
import logoMark from "#/assets/logo-mark.png";
import { m } from "#/paraglide/messages";
import BetterAuthHeader from "../integrations/better-auth/header-user.tsx";
import ParaglideLocaleSwitcher from "./LocaleSwitcher.tsx";
import ThemeToggle from "./ThemeToggle";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-2 sm:px-4 pt-[env(safe-area-inset-top)] backdrop-blur-lg">
      <nav className="page-wrap flex items-center gap-x-1.5 sm:gap-x-4 py-3 sm:py-4">
        {/* 品牌 lockup: 羊皮纸 mark + 衬线字标, 不加容器框——报头语汇, 与右侧
            sans 导航链接拉开层次 */}
        <h2 className="m-0 flex-shrink-0">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 sm:gap-2 text-[var(--ink)] no-underline transition-opacity hover:opacity-80"
          >
            <img src={logoMark} alt="" className="h-6 w-6" />
            <span className="font-serif text-base font-bold tracking-tight sm:text-lg">
              PicX
            </span>
          </Link>
        </h2>

        <div className="hidden md:flex items-center gap-x-4 text-sm font-semibold">
          <Link
            to="/gallery"
            className="nav-link inline-flex items-center gap-1.5"
            activeProps={{ className: "nav-link is-active" }}
          >
            <Globe className="h-4 w-4" />
            <span>{m.nav_explore()}</span>
          </Link>
          <Link
            to="/news"
            className="nav-link inline-flex items-center gap-1.5"
            activeProps={{ className: "nav-link is-active" }}
          >
            <Newspaper className="h-4 w-4" />
            <span>{m.nav_news()}</span>
          </Link>
          <Link
            to="/papers"
            className="nav-link inline-flex items-center gap-1.5"
            activeProps={{ className: "nav-link is-active" }}
          >
            <FileText className="h-4 w-4" />
            <span>{m.nav_papers()}</span>
          </Link>
          <Link
            to="/assistant"
            className="nav-link inline-flex items-center gap-1.5"
            activeProps={{ className: "nav-link is-active" }}
          >
            <Sparkles className="h-4 w-4" />
            <span>{m.nav_assistant()}</span>
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5 md:gap-2 flex-shrink-0">
          <BetterAuthHeader />
          <ParaglideLocaleSwitcher />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
