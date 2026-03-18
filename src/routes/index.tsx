import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowRight,
  FileText,
  Github,
  Heart,
  Network,
  Newspaper,
  Sparkles,
  Upload,
} from "lucide-react";
import { SITE_URL } from "#/lib/site-url";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () => ({
    meta: [
      { title: m.page_title_home() },
      {
        name: "description",
        content:
          "Upload a PDF or arXiv link and get an AI-generated summary and visual whiteboard. Free to try.",
      },
      { property: "og:title", content: m.page_title_home() },
      {
        property: "og:description",
        content:
          "Upload a PDF or arXiv link and get an AI-generated summary and visual whiteboard. Free to try.",
      },
      { property: "og:url", content: `${SITE_URL}/` },
      { property: "og:image", content: `${SITE_URL}/logo512.png` },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:image", content: `${SITE_URL}/logo512.png` },
    ],
  }),
});

function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* Hero Section */}
      <section className="relative overflow-hidden px-4 pb-4 pt-2 sm:px-6 sm:pb-8 sm:pt-4">
        {/* Background decorations */}
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[radial-gradient(circle,rgba(139,111,71,0.12),transparent_70%)] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[radial-gradient(circle,rgba(201,169,97,0.08),transparent_70%)] blur-3xl" />

        <div className="page-wrap relative">
          <div className="mx-auto max-w-4xl text-center">
            {/* Large Logo */}
            <div className="rise-in mb-8 flex justify-center">
              <img
                src="/logo.webp"
                alt="PicX Logo"
                className="w-full max-w-4xl"
                style={{
                  maskImage:
                    "linear-gradient(to right, transparent, black 20%, black 80%, transparent), linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)",
                  WebkitMaskImage:
                    "linear-gradient(to right, transparent, black 20%, black 80%, transparent), linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)",
                  maskComposite: "intersect",
                  WebkitMaskComposite: "source-in",
                }}
              />
            </div>

            {/* Badge */}
            <div
              className="rise-in mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2 text-sm font-medium text-[var(--ink-soft)] shadow-[0_2px_8px_rgba(45,42,36,0.06)]"
              style={{ animationDelay: "100ms" }}
            >
              <Sparkles className="h-4 w-4 text-[var(--academic-brown)]" />
              <span>{m.home_hero_badge()}</span>
            </div>

            {/* Title */}
            <h1
              className="rise-in mb-6 font-serif text-4xl font-bold leading-tight tracking-tight text-[var(--ink)] sm:text-6xl sm:leading-tight"
              style={{ animationDelay: "200ms" }}
            >
              {m.home_hero_title()}
            </h1>

            {/* Subtitle */}
            <p
              className="rise-in mb-10 text-lg text-[var(--ink-soft)] sm:text-xl"
              style={{ animationDelay: "300ms" }}
            >
              {m.home_hero_subtitle()}
            </p>

            {/* Hero Actions */}
            <div
              className="rise-in mx-auto flex max-w-6xl flex-col items-stretch gap-5"
              style={{ animationDelay: "400ms" }}
            >
              <Link
                to="/gallery"
                className="group relative order-1 flex min-h-[88px] flex-1 overflow-hidden rounded-2xl border border-[var(--academic-brown)]/20 bg-gradient-to-br from-[var(--academic-brown)]/5 via-[var(--gold)]/5 to-transparent p-5 text-left transition-all hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(139,111,71,0.16)] sm:max-w-4xl"
              >
                <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(139,111,71,0.12),transparent_70%)] blur-2xl" />
                <div className="pointer-events-none absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-[radial-gradient(circle,rgba(201,169,97,0.1),transparent_70%)] blur-2xl" />

                <div className="relative flex w-full items-center gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--academic-brown),var(--gold))] text-white shadow-[0_4px_16px_rgba(139,111,71,0.24)]">
                    <Newspaper className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="mb-1 font-serif text-base font-semibold text-[var(--ink)] sm:text-lg">
                      {m.home_daily_title()}
                    </h2>
                    <p className="text-sm leading-relaxed text-[var(--ink-soft)]">
                      {m.home_daily_desc()}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2 self-center">
                    <span className="hidden rounded-full bg-[var(--academic-brown)]/10 px-3 py-1 text-xs font-medium text-[var(--academic-brown)] sm:inline-flex sm:items-center sm:gap-1.5">
                      <Sparkles className="h-3 w-3" />
                      {m.home_daily_badge()}
                    </span>
                    <ArrowRight className="h-5 w-5 text-[var(--academic-brown)] transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>

              <Link
                to="/papers"
                className="group order-2 inline-flex w-full items-center justify-center gap-2 self-center rounded-2xl bg-[var(--academic-brown)] px-6 py-4 text-base font-semibold !text-white shadow-[0_4px_16px_rgba(139,111,71,0.24)] transition-all hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(139,111,71,0.32)] active:translate-y-0 no-underline sm:min-w-[168px] sm:w-auto"
              >
                {m.home_cta_start()}
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>

            <p
              className="rise-in mt-4 text-sm text-[var(--ink-soft)]"
              style={{ animationDelay: "500ms" }}
            >
              {m.home_hero_trust_note()}
            </p>
          </div>
        </div>
      </section>

      {/* Showcase Section */}
      <section className="px-4 py-16 sm:px-6">
        <div className="page-wrap">
          <div className="mx-auto max-w-6xl">
            <h2 className="rise-in mb-12 text-center font-serif text-3xl font-bold text-[var(--ink)] sm:text-4xl">
              {m.home_showcase_title()}
            </h2>

            <div className="grid gap-8 md:grid-cols-[1fr_auto_1fr] md:items-center">
              {/* Paper Analysis Card */}
              <div
                className="rise-in group relative overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--surface-strong)] shadow-[0_4px_24px_rgba(45,42,36,0.08)] transition-all hover:-translate-y-2 hover:shadow-[0_12px_40px_rgba(139,111,71,0.16)]"
                style={{ animationDelay: "0ms" }}
              >
                <div className="relative aspect-[16/9] overflow-hidden">
                  <img
                    src="/paper-example.webp"
                    alt="Paper Analysis Example"
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--surface-strong)] via-transparent to-transparent opacity-60" />
                </div>
                <div className="p-6">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[var(--academic-brown)]/10 px-3 py-1 text-sm font-medium text-[var(--academic-brown)]">
                    <FileText className="h-4 w-4" />
                    <span>{m.home_showcase_paper_badge()}</span>
                  </div>
                  <h3 className="mb-2 font-serif text-xl font-semibold text-[var(--ink)]">
                    {m.home_showcase_paper_title()}
                  </h3>
                  <p className="text-sm text-[var(--ink-soft)]">
                    {m.home_showcase_paper_desc()}
                  </p>
                </div>
              </div>

              {/* Arrow between cards */}
              <div
                className="rise-in flex items-center justify-center -my-4 md:my-0"
                style={{ animationDelay: "50ms" }}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--academic-brown)] shadow-[0_4px_16px_rgba(139,111,71,0.32)]">
                  <ArrowDown className="md:hidden h-7 w-7 text-white" />
                  <ArrowRight className="hidden md:inline-block h-7 w-7 text-white" />
                </div>
              </div>

              {/* Whiteboard Card */}
              <div
                className="rise-in group relative overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--surface-strong)] shadow-[0_4px_24px_rgba(45,42,36,0.08)] transition-all hover:-translate-y-2 hover:shadow-[0_12px_40px_rgba(139,111,71,0.16)]"
                style={{ animationDelay: "100ms" }}
              >
                <div className="relative aspect-[16/9] overflow-hidden">
                  <img
                    src="/whiteboard-example.webp"
                    alt="Whiteboard Example"
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--surface-strong)] via-transparent to-transparent opacity-60" />
                </div>
                <div className="p-6">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[var(--gold)]/10 px-3 py-1 text-sm font-medium text-[var(--gold)]">
                    <Network className="h-4 w-4" />
                    <span>{m.home_showcase_whiteboard_badge()}</span>
                  </div>
                  <h3 className="mb-2 font-serif text-xl font-semibold text-[var(--ink)]">
                    {m.home_showcase_whiteboard_title()}
                  </h3>
                  <p className="text-sm text-[var(--ink-soft)]">
                    {m.home_showcase_whiteboard_desc()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-4 py-16 sm:px-6">
        <div className="page-wrap">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Upload,
                title: m.home_feature_upload_title(),
                desc: m.home_feature_upload_desc(),
                delay: "0ms",
              },
              {
                icon: Sparkles,
                title: m.home_feature_ai_title(),
                desc: m.home_feature_ai_desc(),
                delay: "80ms",
              },
              {
                icon: Network,
                title: m.home_feature_whiteboard_title(),
                desc: m.home_feature_whiteboard_desc(),
                delay: "160ms",
              },
              {
                icon: Heart,
                title: m.home_feature_credits_title(),
                desc: m.home_feature_credits_desc(),
                delay: "240ms",
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="rise-in group rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-6 shadow-[0_2px_16px_rgba(45,42,36,0.06)] transition-all hover:-translate-y-2 hover:shadow-[0_8px_24px_rgba(45,42,36,0.12)]"
                style={{ animationDelay: feature.delay }}
              >
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--academic-brown),var(--gold))] text-white shadow-[0_4px_12px_rgba(139,111,71,0.24)]">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="mb-2 font-serif text-lg font-semibold text-[var(--ink)]">
                  {feature.title}
                </h3>
                <p className="text-sm text-[var(--ink-soft)]">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="px-4 py-16 sm:px-6">
        <div className="page-wrap">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-12 text-center font-serif text-3xl font-bold text-[var(--ink)] sm:text-4xl">
              {m.home_flow_title()}
            </h2>

            <div className="space-y-8">
              {[
                { step: "01", text: m.home_flow_step1() },
                { step: "02", text: m.home_flow_step2() },
                { step: "03", text: m.home_flow_step3() },
              ].map((item, index) => (
                <div
                  key={item.step}
                  className="rise-in flex items-start gap-6"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--academic-brown),var(--gold))] text-2xl font-bold text-white shadow-[0_4px_16px_rgba(139,111,71,0.24)]">
                    {item.step}
                  </div>
                  <div className="flex-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-6 shadow-[0_2px_12px_rgba(45,42,36,0.06)]">
                    <p className="text-lg text-[var(--ink)]">{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="px-4 py-8 pb-10 sm:px-6">
        <div className="page-wrap">
          <div className="mx-auto max-w-2xl flex flex-col items-center gap-4 text-center">
            <p className="text-sm text-[var(--ink-soft)]">
              {m.home_credits_main()}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-[var(--ink-soft)]">
              <a
                href="https://github.com/liuchengwucn/picx"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 transition-opacity hover:opacity-70 no-underline text-[var(--ink-soft)]"
              >
                <Github className="h-4 w-4" />
                {m.home_credits_github()}
              </a>
              <span className="text-[var(--line)]">·</span>
              <Link
                to="/about"
                className="transition-opacity hover:opacity-70 no-underline text-[var(--ink-soft)]"
              >
                {m.home_credits_learn_more()}
              </Link>
              <span className="text-[var(--line)]">·</span>
              <a
                href="https://www.emergentmind.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-opacity hover:opacity-70 no-underline text-[var(--ink-soft)]"
              >
                {m.home_credits_see_also()}
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
