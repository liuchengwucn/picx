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
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import TanStackQueryProvider from "../integrations/tanstack-query/root-provider";
import appCss from "../styles.css?url";

interface MyRouterContext {
  queryClient: QueryClient;

  trpc: TRPCOptionsProxy<TRPCRouter>;
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

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
      { name: "viewport", content: "width=device-width, initial-scale=1" },
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
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
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
        <script suppressHydrationWarning>{THEME_INIT_SCRIPT}</script>
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)]">
        <TanStackQueryProvider>
          <DailyBonusClaim />
          <Header />
          {children}
          <Footer />
          <Toaster />
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
        </TanStackQueryProvider>
        <Scripts />
      </body>
    </html>
  );
}
