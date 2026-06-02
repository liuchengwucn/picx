import { Link } from "@tanstack/react-router";
import { Globe, Sparkles } from "lucide-react";
import { Skeleton } from "#/components/ui/skeleton";
import { m } from "#/paraglide/messages";

export interface GalleryCardPaper {
  id: string;
  shortId: string;
  title: string;
  tldr: string;
  whiteboardImageR2Key: string;
  publishedAt: Date | null;
  tags?: string[];
}

/**
 * 把分类 slug 映射到当前语言的显示名(Paraglide)。
 * message key 约定: category_<slug 连字符转下划线>, 缺失时回退 slug 本身。
 * gallery 列表页与分类落地页共用。
 */
export function getCategoryLabel(slug: string): string {
  return (
    (m as Record<string, () => string>)[
      `category_${slug.replace(/-/g, "_")}`
    ]?.() ?? slug
  );
}

interface GalleryCardProps {
  paper: GalleryCardPaper;
  delay: string;
  onTagClick?: (tag: string) => void;
}

export function GalleryCard({ paper, delay, onTagClick }: GalleryCardProps) {
  const imageUrl = `/api/r2/${paper.whiteboardImageR2Key}`;
  const timeAgo = getTimeAgo(paper.publishedAt);
  const visibleTags = paper.tags?.slice(0, 2) ?? [];

  return (
    <Link
      to="/p/$shortId"
      params={{ shortId: paper.shortId }}
      className="rise-in group block no-underline"
      style={{ animationDelay: delay }}
    >
      <article className="flex h-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] shadow-[0_4px_16px_rgba(45,42,36,0.08)] transition-all hover:-translate-y-1 hover:shadow-[0_12px_32px_rgba(139,111,71,0.16)]">
        {/* Whiteboard thumbnail: anchored to top so the paper's title/headline
            (top-left of the whiteboard) stays visible at small sizes. */}
        <div className="relative w-32 shrink-0 overflow-hidden bg-[var(--parchment-warm)] sm:w-44">
          <img
            src={imageUrl}
            alt={paper.title}
            className="absolute inset-0 h-full w-full object-cover object-top transition-transform duration-700 group-hover:scale-105"
            loading="lazy"
          />
          {/* subtle right edge fade into the text column */}
          <div className="absolute inset-y-0 right-0 w-8 bg-gradient-to-r from-transparent to-[var(--surface-strong)] opacity-60" />
        </div>

        {/* Paper info */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 sm:p-5">
          <h3 className="line-clamp-3 font-serif text-lg font-semibold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)] sm:text-xl">
            {paper.title}
          </h3>
          {paper.tldr ? (
            <p className="line-clamp-3 text-sm leading-relaxed text-[var(--ink-soft)]">
              {paper.tldr}
            </p>
          ) : null}
          {/* 底部右对齐两行: 上行时间(最右)+白板图字样, 下行 tag(右下角) */}
          <div className="mt-auto flex flex-col items-end gap-1.5 pt-1">
            <div className="flex items-center gap-3 text-xs text-[var(--ink-soft)]">
              <span className="inline-flex items-center gap-1.5 text-[var(--academic-brown)] opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <Sparkles className="h-3 w-3" />
                <span>{m.paper_whiteboard()}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Globe className="h-3 w-3" />
                <time>{timeAgo}</time>
              </span>
            </div>
            {visibleTags.length > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-1">
                {visibleTags.map((tag) =>
                  onTagClick ? (
                    <button
                      key={tag}
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onTagClick(tag);
                      }}
                      className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--ink-soft)] transition-colors hover:text-[var(--academic-brown)] hover:border-[var(--academic-brown)]"
                    >
                      #{tag}
                    </button>
                  ) : (
                    <span
                      key={tag}
                      className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--ink-soft)]"
                    >
                      #{tag}
                    </span>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}

export function GalleryCardSkeleton() {
  return (
    <div className="flex h-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] shadow-[0_4px_16px_rgba(45,42,36,0.08)]">
      <Skeleton className="w-32 shrink-0 self-stretch sm:w-44" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 sm:p-5">
        <Skeleton className="h-6 w-5/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-auto h-3 w-20" />
      </div>
    </div>
  );
}

function getTimeAgo(date: Date | null): string {
  if (!date) return "";

  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return m.time_today();
  if (diffDays === 1) return m.time_days_ago({ days: "1" });
  if (diffDays < 7) return m.time_days_ago({ days: diffDays.toString() });
  if (diffDays < 30)
    return m.time_weeks_ago({ weeks: Math.floor(diffDays / 7).toString() });
  if (diffDays < 365)
    return m.time_months_ago({ months: Math.floor(diffDays / 30).toString() });
  return m.time_years_ago({ years: Math.floor(diffDays / 365).toString() });
}
