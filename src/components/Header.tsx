import { Link } from "@tanstack/react-router";
import { FileText, Globe, Newspaper, Sparkles } from "lucide-react";
// 与引用分享卡右上角同一枚羊皮纸 mark(logo512 抠底版), 品牌符号全站只此一个。
import logoMark from "#/assets/logo-mark.png";
import { useInGallerySection } from "#/hooks/use-in-gallery-section";
import { m } from "#/paraglide/messages";
import BetterAuthHeader from "../integrations/better-auth/header-user.tsx";
import ParaglideLocaleSwitcher from "./LocaleSwitcher.tsx";
import ThemeToggle from "./ThemeToggle";

export default function Header() {
  // 「画廊」这一项的高亮与 aria-current 刻意不同源, 见 hook 里的解释。
  const inGallerySection = useInGallerySection();

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-2 sm:px-4 pt-[env(safe-area-inset-top)] backdrop-blur-lg">
      <nav className="page-wrap flex items-center gap-x-1.5 sm:gap-x-4 py-3 sm:py-4">
        {/* 品牌 lockup: 羊皮纸 mark + 衬线字标, 不加容器框——报头语汇, 与右侧
            sans 导航链接拉开层次 */}
        <h2 className="m-0 flex-shrink-0">
          <Link
            to="/"
            // 默认是前缀匹配，"/" 会在所有页面上被判为 active 并挂上
            // aria-current="page"（显式传 aria-current={undefined} 也挡不住），
            // 读屏在任何页面都会念出两个「当前页」。首页链接必须精确匹配。
            activeOptions={{ exact: true }}
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
            to="/news"
            className="nav-link inline-flex items-center gap-1.5"
            activeProps={{ className: "nav-link is-active" }}
          >
            <Newspaper className="h-4 w-4" />
            <span>{m.nav_news()}</span>
          </Link>
          <Link
            to="/gallery"
            // aria-current 与视觉高亮在这一项上刻意不同源(为什么该分开见
            // use-in-gallery-section.ts): aria-current 回答"这就是当前这一页",
            // 必须精确, 否则方向页上 Header 与页面自己的方向 tab 会同时挂
            // aria-current="page"(TanStack 的 STATIC_ACTIVE_PROPS 在用户 props 之后
            // 展开, 显式传 aria-current={undefined} 挡不住默认的前缀匹配), 读屏一次
            // 念出两个"当前页"。activeOptions exact 把这个语义钉死在落地页本身;
            // is-active(视觉)另走 inGallerySection, 不受 exact 影响。TanStack 的
            // activeProps 会把两者绑在一起(只在 isActive 时生效), 所以不用它。
            activeOptions={{ exact: true }}
            className={`nav-link inline-flex items-center gap-1.5${inGallerySection ? " is-active" : ""}`}
          >
            <Globe className="h-4 w-4" />
            {/* nav_gallery 是导航标签, edition_kicker(刊头刊名)、home_kicker_gallery
                (首页卡栏眉)是刊物名 —— 三个键刻意分开而不是待清理的重复, 各自有独立的
                改写理由。这里就是一例: 导航为了排版缩成「周刊」, 刊名仍是「画廊周刊」,
                若当初合并成一个键, 这次改动会连坐刊头和首页卡。
                刊名那两处彼此仍须同值: 同一个目的地在全站只能有一个名字。描述内容的
                文案(如 home_cta_gallery「浏览方向简报」)不受这条约束。 */}
            <span>{m.nav_gallery()}</span>
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
