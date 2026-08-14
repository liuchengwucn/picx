import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import DailyBonusClaim from "#/components/DailyBonusClaim";
import { Toaster } from "#/components/ui/sonner";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { initLocale } from "#/lib/locale-init";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";
import Footer from "../components/Footer";
import Header from "../components/Header";
import MobileTabBar from "../components/MobileTabBar";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import appCss from "../styles.css?url";

interface MyRouterContext {
  queryClient: QueryClient;

  trpc: TRPCOptionsProxy<TRPCRouter>;
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;var tc=document.getElementById('theme-color');if(tc){tc.setAttribute('content',resolved==='dark'?'#1a1816':'#faf8f3')}}catch(e){}})();`;

export const Route = createRootRouteWithContext<MyRouterContext>()({
  beforeLoad: async () => {
    // Initialize locale based on browser language on first visit
    initLocale();

    // Other redirect strategies are possible; see
    // https://github.com/TanStack/router/tree/main/examples/react/i18n-paraglide#offline-redirect
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("lang", getLocale());
    }
  },

  notFoundComponent: () => {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <h1 className="mb-4 font-serif text-4xl font-bold text-[var(--ink)]">
            404
          </h1>
          <p className="mb-6 text-lg text-[var(--ink-soft)]">
            {m.not_found_description()}
          </p>
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--academic-brown)] px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(139,111,71,0.24)] transition-all hover:-translate-y-1 hover:shadow-[0_6px_16px_rgba(139,111,71,0.32)] no-underline"
          >
            {m.not_found_back_home()}
          </a>
        </div>
      </div>
    );
  },

  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { title: "PicX - Paper Whiteboard" },
      {
        name: "description",
        content:
          "PicX turns academic papers into visual whiteboards. Upload a PDF or arXiv link and get an AI-generated summary and whiteboard image instantly.",
      },
      { property: "og:site_name", content: "PicX" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://picx.dev/logo512.png" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:image", content: "https://picx.dev/logo512.png" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "black-translucent",
      },
      { name: "apple-mobile-web-app-title", content: "PicX" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
    scripts: [
      {
        src: "https://www.googletagmanager.com/gtag/js?id=G-QTJLY71E59",
        async: true,
      },
      {
        children: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-QTJLY71E59');`,
      },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang={getLocale()} suppressHydrationWarning>
      <head>
        {/* 单条 theme-color, 交给 THEME_INIT_SCRIPT 按已解析主题(而非系统偏好)
            同步 content, 让手动切换的站内主题也能驱动 OS 状态栏/地址栏着色。
            不能挪回 head() 的 meta 数组: TanStack Router 的 HeadContent 按 name
            去重, 两条同 name 不同 media 的 theme-color 会被丢掉一条(c4a1f7e 修的
            就是这个)。meta 先于脚本执行, 是 React hoistable 元素的 flush 顺序保证
            的, 脚本里的 if(tc) 守卫兜底以防万一。 */}
        {/* biome-ignore lint/correctness/useUniqueElementIds: RootDocument renders once per
            document, and THEME_INIT_SCRIPT looks this up by literal id before React boots. */}
        <meta name="theme-color" id="theme-color" content="#faf8f3" />
        <script suppressHydrationWarning>{THEME_INIT_SCRIPT}</script>
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)] pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <DailyBonusClaim />
        <Header />
        {children}
        <Footer />
        <MobileTabBar />
        <Toaster />
        {import.meta.env.DEV && (
          <TanStackDevtools
            config={{
              position: "bottom-right",
            }}
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
              TanStackQueryDevtools,
            ]}
          />
        )}
        <Scripts />
      </body>
    </html>
  );
}
