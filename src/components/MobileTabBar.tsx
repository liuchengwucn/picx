import { Link } from "@tanstack/react-router";
import { FileText, Globe, Home, Newspaper, Sparkles } from "lucide-react";
import { useInGallerySection } from "#/hooks/use-in-gallery-section";
import { m } from "#/paraglide/messages";

// 小屏底部 Tab 栏, md 以上隐藏(与 Header 导航组互斥切换)。
// 首页 Tab 需 exact, 否则任何路由都命中 "/" 前缀而常亮。
const ITEM_CLASS =
  "tab-link flex flex-1 flex-col items-center gap-0.5 py-2 no-underline";

export default function MobileTabBar() {
  // 「画廊」这一项同 Header.tsx: 高亮与 aria-current 刻意不同源, 见 hook 里的解释。
  const inGallerySection = useInGallerySection();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--line)] bg-[var(--header-bg)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-lg md:hidden"
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
          to="/gallery"
          // aria-current 与视觉高亮不同源, 与 Header.tsx 的「画廊」项同一处理
          // (为什么该分开见 use-in-gallery-section.ts)。exact 把 aria-current="page"
          // 钉在落地页本身, 否则这个 tab 会在 /gallery/d/*、/gallery/archive、
          // /gallery/w/* 上都判成 active, 与页面内容自己的方向 tab 同时挂
          // aria-current="page"(即便本栏在桌面视口 md:hidden, DOM 里那个属性依然
          // 存在, querySelectorAll 照样数得到, 移动视口下更是两个都可见)。
          // is-active(--academic-brown 着色)另走 inGallerySection, 不受 exact 影响。
          activeOptions={{ exact: true }}
          className={`${ITEM_CLASS}${inGallerySection ? " is-active" : ""}`}
        >
          <Globe className="h-5 w-5" />
          <span className="text-[10px] font-medium leading-none whitespace-nowrap">
            {/* 短形而非 nav_gallery: 底栏五等分, 375px 下每格约 75px, 10px 字放得下
                2–3 个汉字; 全名「画廊周刊 / 週刊ギャラリー」在 whitespace-nowrap 下
                只会溢出到邻格 */}
            {m.nav_gallery_short()}
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
