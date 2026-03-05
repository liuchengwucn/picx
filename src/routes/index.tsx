import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Coins,
  FileText,
  Network,
  Sparkles,
  Upload,
} from "lucide-react";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* Hero Section */}
      <section className="relative overflow-hidden px-4 pb-16 pt-20 sm:px-6 sm:pb-24 sm:pt-32">
        {/* Background decorations */}
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[radial-gradient(circle,rgba(139,111,71,0.12),transparent_70%)] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[radial-gradient(circle,rgba(201,169,97,0.08),transparent_70%)] blur-3xl" />

        <div className="page-wrap relative">
          <div className="mx-auto max-w-4xl text-center">
            {/* Badge */}
            <div className="rise-in mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2 text-sm font-medium text-[var(--ink-soft)] shadow-[0_2px_8px_rgba(45,42,36,0.06)]">
              <Sparkles className="h-4 w-4 text-[var(--academic-brown)]" />
              <span>AI-Powered Research Assistant</span>
            </div>

            {/* Title */}
            <h1
              className="rise-in mb-6 text-4xl font-bold leading-tight tracking-tight text-[var(--ink)] sm:text-6xl sm:leading-tight"
              style={{ animationDelay: "100ms" }}
            >
              {m.home_hero_title()}
            </h1>

            {/* Subtitle */}
            <p
              className="rise-in mb-10 text-lg text-[var(--ink-soft)] sm:text-xl"
              style={{ animationDelay: "200ms" }}
            >
              {m.home_hero_subtitle()}
            </p>

            {/* CTA Button */}
            <Link
              to="/papers"
              className="rise-in group inline-flex items-center gap-2 rounded-xl bg-[var(--academic-brown)] px-8 py-4 text-base font-semibold text-white shadow-[0_4px_16px_rgba(139,111,71,0.24)] transition-all hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(139,111,71,0.32)] active:translate-y-0"
              style={{ animationDelay: "300ms" }}
            >
              {m.home_cta_start()}
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
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
                title: m.home_feature_mindmap_title(),
                desc: m.home_feature_mindmap_desc(),
                delay: "160ms",
              },
              {
                icon: Coins,
                title: m.home_feature_credits_title(),
                desc: m.home_feature_credits_desc(),
                delay: "240ms",
              },
            ].map((feature, index) => (
              <div
                key={feature.title}
                className="rise-in group rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-6 shadow-[0_2px_16px_rgba(45,42,36,0.06)] transition-all hover:-translate-y-2 hover:shadow-[0_8px_24px_rgba(45,42,36,0.12)]"
                style={{ animationDelay: feature.delay }}
              >
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--academic-brown),var(--gold))] text-white shadow-[0_4px_12px_rgba(139,111,71,0.24)]">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-[var(--ink)]">
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
            <h2 className="mb-12 text-center text-3xl font-bold text-[var(--ink)] sm:text-4xl">
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

      {/* Credits Info Section */}
      <section className="px-4 py-16 pb-24 sm:px-6">
        <div className="page-wrap">
          <div className="mx-auto max-w-2xl rounded-3xl border border-[var(--line)] bg-[var(--surface-strong)] p-8 shadow-[0_4px_24px_rgba(45,42,36,0.08)] sm:p-12">
            <div className="mb-6 flex items-center justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--academic-brown),var(--gold))] shadow-[0_4px_16px_rgba(139,111,71,0.24)]">
                <Coins className="h-8 w-8 text-white" />
              </div>
            </div>

            <h2 className="mb-4 text-center text-2xl font-bold text-[var(--ink)] sm:text-3xl">
              {m.home_credits_title()}
            </h2>

            <div className="space-y-4 text-center">
              <p className="text-lg text-[var(--ink-soft)]">
                {m.home_credits_new_user()}
              </p>
              <p className="text-base text-[var(--ink-soft)]">
                {m.home_credits_cost()}
              </p>
            </div>

            <div className="mt-8 text-center">
              <Link
                to="/papers"
                className="inline-flex items-center gap-2 rounded-xl border-2 border-[var(--academic-brown)] bg-transparent px-6 py-3 text-base font-semibold text-[var(--academic-brown)] transition-all hover:bg-[var(--academic-brown)] hover:text-white"
              >
                {m.home_cta_start()}
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
