import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Cloud,
  Code2,
  Database,
  Github,
  Globe,
  Image,
  RefreshCw,
  Rss,
  Sparkles,
  Zap,
} from "lucide-react";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/about")({
  component: AboutPage,
  head: () => ({
    meta: [
      { title: m.page_title_about() },
      {
        name: "description",
        content:
          "PicX turns academic papers into visual whiteboards. Free, open-source, with daily HuggingFace paper digests.",
      },
      { property: "og:title", content: m.page_title_about() },
      { property: "og:url", content: "https://picx.cn/about" },
    ],
  }),
});

const STACK = [
  { icon: Cloud, label: "Cloudflare Workers", desc: "Edge runtime" },
  { icon: Database, label: "Cloudflare D1", desc: "SQLite at the edge" },
  { icon: Globe, label: "TanStack Start", desc: "Full-stack React SSR" },
  { icon: Bot, label: "Gemini / OpenAI", desc: "AI summarization" },
  { icon: Image, label: "Cloudflare R2", desc: "Whiteboard image storage" },
  { icon: Code2, label: "Open Source", desc: "MIT licensed" },
];

const DAILY_STEPS = [
  { icon: Rss, key: "about_daily_step1" as const },
  { icon: RefreshCw, key: "about_daily_step2" as const },
  { icon: Sparkles, key: "about_daily_step3" as const },
  { icon: Globe, key: "about_daily_step4" as const },
];

function AboutPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
        {/* bg blobs */}
        <div className="pointer-events-none absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(139,111,71,0.10),transparent_65%)] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -right-40 h-[400px] w-[400px] rounded-full bg-[radial-gradient(circle,rgba(201,169,97,0.07),transparent_65%)] blur-3xl" />

        <div className="page-wrap relative">
          {/* label */}
          <p className="rise-in mb-4 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--academic-brown)]">
            {m.about_hero_label()}
          </p>

          {/* big editorial title */}
          <h1
            className="rise-in mb-6 font-serif text-5xl font-bold leading-[1.05] tracking-tight text-[var(--ink)] sm:text-7xl lg:text-8xl"
            style={{ animationDelay: "80ms" }}
          >
            {m.about_hero_title()}
          </h1>

          {/* subtitle */}
          <p
            className="rise-in max-w-2xl text-lg leading-relaxed text-[var(--ink-soft)] sm:text-xl"
            style={{ animationDelay: "160ms" }}
          >
            {m.about_hero_subtitle()}
          </p>
        </div>
      </section>

      {/* ── Divider rule ── */}
      <div className="page-wrap">
        <div className="h-px bg-[var(--line)]" />
      </div>

      {/* ── Mission ── */}
      <section className="px-4 py-16 sm:px-6">
        <div className="page-wrap">
          <div className="grid gap-12 lg:grid-cols-[1fr_2fr] lg:gap-20 lg:items-start">
            <div>
              <p className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--academic-brown)]">
                {m.about_mission_label()}
              </p>
              <h2 className="font-serif text-3xl font-bold leading-tight text-[var(--ink)] sm:text-4xl">
                {m.about_mission_title()}
              </h2>
            </div>
            <div className="flex items-center">
              <p className="text-lg leading-relaxed text-[var(--ink-soft)]">
                {m.about_mission_body()}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Daily HuggingFace digest ── */}
      <section className="px-4 py-16 sm:px-6">
        <div className="page-wrap">
          {/* section header */}
          <div className="mb-12">
            <p className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--academic-brown)]">
              {m.about_daily_label()}
            </p>
            <h2 className="mb-4 font-serif text-3xl font-bold leading-tight text-[var(--ink)] sm:text-4xl">
              {m.about_daily_title()}
            </h2>
            <p className="max-w-2xl text-base leading-relaxed text-[var(--ink-soft)]">
              {m.about_daily_body()}
            </p>
          </div>

          {/* pipeline steps */}
          <div className="relative">
            {/* connecting line (desktop) */}
            <div className="absolute left-8 top-8 hidden h-[calc(100%-4rem)] w-px bg-gradient-to-b from-[var(--academic-brown)] via-[var(--gold)] to-transparent lg:block" />

            <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-4 lg:gap-6">
              {DAILY_STEPS.map(({ icon: Icon, key }, i) => (
                <div
                  key={key}
                  className="rise-in relative flex items-start gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-5 shadow-[0_2px_16px_rgba(45,42,36,0.06)] lg:flex-col lg:gap-3"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  {/* step number badge */}
                  <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--academic-brown),var(--gold))] shadow-[0_4px_12px_rgba(139,111,71,0.24)]">
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--academic-brown)]">
                      0{i + 1}
                    </span>
                    <p className="text-sm font-medium leading-snug text-[var(--ink)]">
                      {m[key]()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Tech Stack ── */}
      <section className="px-4 py-16 sm:px-6">
        <div className="page-wrap">
          <div className="mb-10">
            <p className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--academic-brown)]">
              {m.about_stack_label()}
            </p>
            <h2 className="font-serif text-3xl font-bold leading-tight text-[var(--ink)] sm:text-4xl">
              {m.about_stack_title()}
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STACK.map(({ icon: Icon, label, desc }, i) => (
              <div
                key={label}
                className="rise-in group flex items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-5 py-4 shadow-[0_2px_12px_rgba(45,42,36,0.05)] transition-all hover:-translate-y-1 hover:shadow-[0_6px_20px_rgba(139,111,71,0.12)]"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--academic-brown)]/10 text-[var(--academic-brown)] transition-colors group-hover:bg-[var(--academic-brown)] group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">
                    {label}
                  </p>
                  <p className="text-xs text-[var(--ink-soft)]">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Open Source ── */}
      <section className="px-4 py-16 sm:px-6">
        <div className="page-wrap">
          <div className="relative overflow-hidden rounded-3xl border-2 border-[var(--academic-brown)] bg-gradient-to-br from-[var(--academic-brown)]/5 via-[var(--gold)]/5 to-transparent p-8 sm:p-12">
            {/* decorative large text */}
            <span className="pointer-events-none absolute -right-4 -top-6 select-none font-serif text-[10rem] font-bold leading-none text-[var(--academic-brown)]/5 sm:text-[14rem]">
              OSS
            </span>

            <div className="relative">
              <p className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--academic-brown)]">
                {m.about_open_label()}
              </p>
              <h2 className="mb-4 font-serif text-3xl font-bold leading-tight text-[var(--ink)] sm:text-4xl">
                {m.about_open_title()}
              </h2>
              <p className="mb-8 max-w-xl text-base leading-relaxed text-[var(--ink-soft)]">
                {m.about_open_body()}
              </p>
              <a
                href="https://github.com/liuchengwucn/picx"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--academic-brown)] px-6 py-3 text-sm font-semibold !text-white shadow-[0_4px_16px_rgba(139,111,71,0.28)] transition-all hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(139,111,71,0.36)] no-underline"
              >
                <Github className="h-4 w-4" />
                {m.about_open_github()}
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="px-4 pb-24 pt-8 sm:px-6">
        <div className="page-wrap">
          <div className="h-px bg-[var(--line)] mb-16" />
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="mb-2 font-serif text-2xl font-bold text-[var(--ink)] sm:text-3xl">
                {m.about_cta_title()}
              </h2>
              <p className="text-base text-[var(--ink-soft)]">
                {m.about_cta_body()}
              </p>
            </div>
            <div className="flex flex-shrink-0 flex-col gap-3 sm:flex-row">
              <Link
                to="/gallery"
                className="inline-flex items-center gap-2 rounded-xl border-2 border-[var(--academic-brown)] px-5 py-3 text-sm font-semibold !text-[var(--academic-brown)] transition-all hover:bg-[var(--academic-brown)] hover:!text-white no-underline"
              >
                <BookOpen className="h-4 w-4" />
                {m.about_cta_gallery()}
              </Link>
              <Link
                to="/papers"
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--academic-brown)] px-5 py-3 text-sm font-semibold !text-white shadow-[0_4px_16px_rgba(139,111,71,0.24)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(139,111,71,0.32)] no-underline"
              >
                <Zap className="h-4 w-4" />
                {m.about_cta_upload()}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
