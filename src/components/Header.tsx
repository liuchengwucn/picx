import { Link, useMatchRoute } from "@tanstack/react-router";
import { FileText, Globe, Newspaper, Sparkles } from "lucide-react";
// 与引用分享卡右上角同一枚羊皮纸 mark(logo512 抠底版), 品牌符号全站只此一个。
import logoMark from "#/assets/logo-mark.png";
import { m } from "#/paraglide/messages";
import BetterAuthHeader from "../integrations/better-auth/header-user.tsx";
import ParaglideLocaleSwitcher from "./LocaleSwitcher.tsx";
import ThemeToggle from "./ThemeToggle";

export default function Header() {
  const matchRoute = useMatchRoute();
  // 「画廊」这一项的高亮与 aria-current 刻意不同源(见下面 Link 上的注释): 这里用
  // fuzzy:true(前缀匹配)算"是否身处 gallery 这个分区", 驱动的只是视觉 className。
  const inGallerySection = Boolean(matchRoute({ to: "/gallery", fuzzy: true }));

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
            // aria-current 与视觉高亮在这一项上刻意不同源, 两个判据服务两件不同的事:
            //
            // - aria-current 回答"这就是当前这一页" —— 必须精确, 否则方向页上
            //   Header 与页面自己的方向 tab 会同时挂 aria-current="page"(TanStack
            //   的 STATIC_ACTIVE_PROPS 在用户 props 之后展开, 显式传
            //   aria-current={undefined} 挡不住默认的前缀匹配), 读屏一次念出两个
            //   "当前页"。activeOptions exact 把这个语义钉死在落地页本身。
            // - is-active(视觉)回答"我在 gallery 这个分区里" —— 分区与分区内
            //   当前项是同一层级树的两级, 不是互斥的两个身份: 顶栏亮"画廊" +
            //   方向 tab 亮当前方向, 用户才知道"我在哪个分区、分区里又在哪一项"。
            //   前缀匹配(下面的 inGallerySection, useMatchRoute fuzzy:true)才是
            //   这件事该用的判据; 若也收窄成 exact, 用户在 /gallery/archive、
            //   /gallery/d/*、/gallery/w/* 这些改版后 gallery 下的绝大多数页面上
            //   会失去方位感 —— 之前这里的注释把"视觉跟着 aria 一起收窄"当成收益,
            //   是错的, 不要合回去。
            //
            // TanStack 的 activeProps 把两者绑在一起(只在 isActive 时生效), 所以
            // 不用它, className 靠 inGallerySection 手算。
            activeOptions={{ exact: true }}
            className={`nav-link inline-flex items-center gap-1.5${inGallerySection ? " is-active" : ""}`}
          >
            <Globe className="h-4 w-4" />
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
