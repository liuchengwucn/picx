import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Github,
  MessageCircle,
  Rss,
  Search,
} from "lucide-react";
import { ModuleKicker } from "#/components/home/module-kicker";
import { TodayStrip } from "#/components/home/today-strip";
import type { HomeToday } from "#/lib/home/today";
import { SITE_URL } from "#/lib/site-url";
import { m } from "#/paraglide/messages";

interface AppEnvBindings {
  DB: D1Database;
}

// JSON-LD 面向爬虫,不跟随界面语言:固定英文串,避免同一 URL 因访客语言产生不同结构化数据。
const JSON_LD_DESCRIPTION =
  "Track AI news; discover, read, and discuss papers from any field with AI — plus one-click visual whiteboards.";

const GITHUB_URL = "https://github.com/liuchengwucn/picx";

export const Route = createFileRoute("/")({
  component: HomePage,
  loader: async ({ context }): Promise<{ today: HomeToday | null }> => {
    if (import.meta.env.SSR) {
      // SSR 直读 D1。绝不能走 tRPC / 模块级 QueryClient:那会让首屏内容按 Worker
      // 进程冻结(head 新 / body 旧)。
      try {
        const { env } = await import("cloudflare:workers");
        const { drizzle } = await import("drizzle-orm/d1");
        const schema = await import("#/db/schema");
        const { getHomeToday } = await import("#/lib/home/today");
        const appEnv = env as typeof env & AppEnvBindings;
        return { today: await getHomeToday(drizzle(appEnv.DB, { schema })) };
      } catch (e) {
        // D1 抖动:今日精选整区隐藏,静态区照常渲染,首页不至于整页失败。
        // 但降级是静默的——不记日志的话,首页少半屏内容在线上完全看不出来。
        console.error("home today loader failed", e);
        return { today: null };
      }
    }
    try {
      const today = await context.queryClient.ensureQueryData(
        context.trpc.home.today.queryOptions(),
      );
      return { today };
    } catch (e) {
      console.error("home today loader failed", e);
      return { today: null };
    }
  },
  head: () => {
    const title = m.page_title_home();
    const description = m.home_meta_description();
    const url = `${SITE_URL}/`;
    const image = `${SITE_URL}/logo512.png`;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { property: "og:image", content: image },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: image },
      ],
      links: [
        { rel: "canonical", href: url },
        // 报头 logo 是首屏 LCP 元素。优先级提示只写在 <img fetchPriority> 上:
        // React 会额外 hoist 一份不带属性的 preload 到 head 顶部, 先到先得,
        // 挂在这个 link 上的 fetchPriority 会被那份丢弃掉。
        { rel: "preload", as: "image", href: "/logo.webp" },
      ],
      scripts: [
        {
          type: "application/ld+json",
          // 防止 </script> 逃逸:children 经 dangerouslySetInnerHTML 注入,必须转义 <
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "WebSite",
                "@id": `${SITE_URL}/#website`,
                name: "PicX",
                url,
                description: JSON_LD_DESCRIPTION,
                publisher: { "@id": `${SITE_URL}/#organization` },
              },
              {
                "@type": "Organization",
                "@id": `${SITE_URL}/#organization`,
                name: "PicX",
                url,
                logo: image,
                sameAs: [GITHUB_URL],
              },
            ],
          }).replace(/</g, "\\u003c"),
        },
      ],
    };
  },
});

// 序号编码真实工作流顺序(追踪 → 发现 → 阅读 → 讨论),不是装饰性编号。
const WORKFLOW_STEPS = [
  {
    id: "track",
    icon: Rss,
    title: m.home_step_track_title,
    desc: m.home_step_track_desc,
  },
  {
    id: "discover",
    icon: Search,
    title: m.home_step_discover_title,
    desc: m.home_step_discover_desc,
  },
  {
    id: "read",
    icon: BookOpen,
    title: m.home_step_read_title,
    desc: m.home_step_read_desc,
  },
  {
    id: "discuss",
    icon: MessageCircle,
    title: m.home_step_discuss_title,
    desc: m.home_step_discuss_desc,
  },
] as const;

function HomePage() {
  const { today } = Route.useLoaderData();

  return (
    <main className="min-h-screen">
      {/* 报头:单棕线收边,零纹理零渐变 */}
      <header className="rise-in border-b border-[color-mix(in_srgb,var(--academic-brown)_35%,transparent)] px-4 pb-10 pt-4 text-center sm:px-6 sm:pb-12">
        <div className="page-wrap">
          <img
            src="/logo.webp"
            alt="PicX"
            width={1408}
            height={768}
            fetchPriority="high"
            className="mx-auto w-full max-w-2xl"
            style={{
              maskImage:
                "linear-gradient(to right, transparent, black 20%, black 80%, transparent), linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)",
              WebkitMaskImage:
                "linear-gradient(to right, transparent, black 20%, black 80%, transparent), linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)",
              maskComposite: "intersect",
              WebkitMaskComposite: "source-in",
            }}
          />

          <h1 className="mx-auto max-w-3xl font-serif text-[1.75rem] font-bold leading-tight tracking-tight text-[var(--ink)] sm:text-[2.5rem] sm:leading-[1.22]">
            {m.home_h1_prefix()}
            {/* 金色高亮沿用站内「划线引用」语义:背景条走 background-image,
                boxDecorationBreak:clone 让它在换行处逐行断开而不是拉成一条 */}
            <span
              className="px-[0.08em]"
              style={{
                backgroundImage:
                  "linear-gradient(color-mix(in srgb, var(--gold) 28%, transparent) 0 100%)",
                backgroundRepeat: "no-repeat",
                backgroundSize: "100% 0.42em",
                backgroundPosition: "0 86%",
                boxDecorationBreak: "clone",
                WebkitBoxDecorationBreak: "clone",
              }}
            >
              {m.home_h1_em()}
            </span>
          </h1>

          <p className="mx-auto mt-3 max-w-2xl text-sm text-[var(--ink-soft)] sm:text-base">
            {m.home_new_subtitle()}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/papers"
              className="rounded-xl bg-[var(--academic-brown)] px-5 py-2.5 text-sm font-semibold !text-white no-underline shadow-[0_4px_14px_rgba(139,111,71,0.24)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(139,111,71,0.3)] active:translate-y-0"
            >
              {m.home_cta_upload()}
            </Link>
            <Link
              to="/gallery"
              className="rounded-xl border-[1.5px] border-[var(--academic-brown)] px-5 py-2.5 text-sm font-semibold text-[var(--academic-brown)] no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--academic-brown)_8%,transparent)]"
            >
              {m.home_cta_gallery()}
            </Link>
          </div>
        </div>
      </header>

      <TodayStrip today={today} />

      {/* 叙事区:这个网站到底做什么 */}
      <section className="px-4 pt-12 sm:px-6 sm:pt-16">
        <div className="page-wrap">
          <ModuleKicker color="var(--academic-brown)">
            {m.home_whatis_label()}
          </ModuleKicker>

          <h2 className="mx-auto mt-5 max-w-3xl text-balance text-center font-serif text-xl font-bold leading-snug text-[var(--ink)] sm:text-2xl">
            {m.home_whatis_title()}
          </h2>

          <div className="stagger-in mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW_STEPS.map((step, index) => (
              <article
                key={step.id}
                className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-5 shadow-[0_2px_12px_rgba(45,42,36,0.05)]"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute -top-1 right-3 select-none font-serif text-6xl font-bold leading-none text-[var(--academic-brown)] opacity-[0.09] dark:opacity-[0.07]"
                >
                  {index + 1}
                </span>
                <step.icon
                  aria-hidden
                  className="h-[26px] w-[26px] text-[var(--academic-brown)]"
                  strokeWidth={1.25}
                />
                <h3 className="mt-3 font-serif text-base font-semibold text-[var(--ink)]">
                  {step.title()}
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--ink-soft)]">
                  {step.desc()}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 论文 → 白板:刻意放在叙事区之后,它是顺带能力而不是主线 */}
      <section className="px-4 pt-12 sm:px-6 sm:pt-16">
        <div className="page-wrap">
          <div className="mx-auto max-w-5xl rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4 shadow-[0_2px_12px_rgba(45,42,36,0.05)] sm:p-5">
            <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
              <img
                src="/paper-example.webp"
                alt=""
                loading="lazy"
                width={1680}
                height={920}
                className="w-full rounded-xl shadow-[0_4px_16px_rgba(45,42,36,0.12)]"
              />
              <div
                aria-hidden
                className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-[var(--academic-brown)] text-[var(--academic-brown)]"
              >
                <ArrowDown className="h-4 w-4 sm:hidden" strokeWidth={1.25} />
                <ArrowRight
                  className="hidden h-4 w-4 sm:block"
                  strokeWidth={1.25}
                />
              </div>
              <img
                src="/whiteboard-example.webp"
                alt=""
                loading="lazy"
                width={1408}
                height={768}
                className="w-full rounded-xl shadow-[0_4px_16px_rgba(45,42,36,0.12)]"
              />
            </div>
          </div>
          {/* 这句配文就是本区唯一的说明,直接当 h2 用:两图是纯示意(alt=""),
              没有它这一区在可访问性树里是无名的。preflight 已抹掉 h2 默认字号/边距,
              渲染结果与原来的 <p> 逐像素一致——所以不必再叠一个 sr-only 标题去重复朗读。 */}
          <h2 className="mt-3 text-center text-[13px] font-normal text-[var(--ink-soft)]">
            {m.home_wb_note()}
          </h2>
        </div>
      </section>

      {/* 信息带:站点自身的三条事实,一行收尾 */}
      <section className="px-4 py-12 sm:px-6 sm:py-16">
        <div className="page-wrap flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-[var(--ink-soft)]">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[var(--ink-soft)] no-underline transition-opacity hover:opacity-70"
          >
            <Github className="h-3.5 w-3.5" strokeWidth={1.25} />
            {m.home_foot_github()}
          </a>
          <span aria-hidden className="text-[var(--line)]">
            ·
          </span>
          <span>{m.home_foot_free()}</span>
          <span aria-hidden className="text-[var(--line)]">
            ·
          </span>
          <a
            href="https://www.emergentmind.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--ink-soft)] no-underline transition-opacity hover:opacity-70"
          >
            {m.home_foot_seealso()}
          </a>
        </div>
      </section>
    </main>
  );
}
