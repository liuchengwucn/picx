import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import {
  GalleryCard,
  GalleryCardSkeleton,
} from "#/components/papers/gallery-card";
import { Button } from "#/components/ui/button";
import { LoadFailedPanel } from "#/components/ui/state-panel";
import { useTRPC } from "#/integrations/trpc/react";
import { startGitHubSignIn } from "#/lib/auth-client";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

const PREVIEW_LIMIT = 12;
const skeletonKeys = ["s1", "s2", "s3", "s4", "s5", "s6"];

/**
 * /papers 的匿名形态: 公开论文流 + 登录引导。刻意不带搜索/筛选 —— 全站检索归
 * /gallery/archive, 这里只回答「这个站的论文长什么样」。
 */
export function PapersPublicPreview() {
  const trpc = useTRPC();
  const locale = getLocale();
  const previewQuery = useQuery(
    trpc.paper.listPublic.queryOptions({
      page: 1,
      limit: PREVIEW_LIMIT,
      sort: "recent",
      locale,
    }),
  );
  const papers = previewQuery.data?.papers ?? [];

  return (
    <main className="page-wrap py-8">
      <div className="stagger-in">
        <h1 className="font-serif text-2xl font-bold text-[var(--ink)]">
          {m.papers_public_title()}
        </h1>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3">
          <p className="text-sm text-[var(--ink-soft)]">
            {m.papers_public_login_hint()}
          </p>
          <Button size="sm" onClick={() => void startGitHubSignIn("/papers")}>
            {m.auth_sign_in_github()}
          </Button>
        </div>

        <h2 className="mt-8 flex items-center gap-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--academic-brown)] after:h-px after:flex-1 after:bg-[var(--line)] after:content-['']">
          {m.papers_public_heading()}
        </h2>

        {previewQuery.isLoading ? (
          <div className="mt-4 grid auto-rows-fr gap-5 lg:grid-cols-2">
            {skeletonKeys.map((key) => (
              <GalleryCardSkeleton key={key} />
            ))}
          </div>
        ) : previewQuery.isError ? (
          <LoadFailedPanel onRetry={() => previewQuery.refetch()} />
        ) : papers.length > 0 ? (
          <div className="mt-4 grid auto-rows-fr gap-5 lg:grid-cols-2">
            {papers.map((paper, index) => (
              <GalleryCard
                key={paper.id}
                paper={paper}
                delay={`${index * 50}ms`}
              />
            ))}
          </div>
        ) : null}

        {/* 色类被未分层 a{color} 覆盖，靠同 token 值成立；改色时须包内层 span */}
        <Link
          to="/gallery/archive"
          className="group mt-8 inline-flex items-center gap-1 text-sm font-semibold text-[var(--academic-brown)] no-underline transition-colors hover:text-[var(--academic-brown-deep)]"
        >
          {m.papers_public_browse_archive()}
          <ArrowRight
            className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
            strokeWidth={1.25}
          />
        </Link>
      </div>
    </main>
  );
}
