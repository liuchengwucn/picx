import { Link } from "@tanstack/react-router";
import { Clock, MessageSquare } from "lucide-react";
import { ScoreBadge } from "#/components/news/score-badge";
import { Badge } from "#/components/ui/badge";
import { Skeleton } from "#/components/ui/skeleton";
import type { StorySignalsSummary } from "#/db/schema";
import { formatRelative } from "#/lib/relative-time";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

export interface StoryCardStory {
  shortId: string;
  title: string;
  summary: string;
  tags: string[];
  itemCount: number;
  sourceCount: number;
  signalsSummary: StorySignalsSummary | null;
  firstSeenAt: Date | string;
  earliestPublishedAt: Date | string | null;
  lastActivityAt: Date;
  status: string;
  scoreMin: number | null;
  scoreMax: number | null;
}

interface StoryCardProps {
  story: StoryCardStory;
  delay: string;
  showScores?: boolean;
}

// 来源 favicon 叠放上限:超过 5 个只显示前 5,数量交给文字计数表达
const MAX_FAVICONS = 5;
const MAX_TAGS = 3;

export function StoryCard({ story, delay, showScores }: StoryCardProps) {
  const domains = story.signalsSummary?.domains?.slice(0, MAX_FAVICONS) ?? [];
  const hn = story.signalsSummary?.hn;
  const xAccounts = story.signalsSummary?.xAccounts;
  const visibleTags = story.tags.slice(0, MAX_TAGS);
  const timeAgo = formatRelative(
    new Date(story.earliestPublishedAt ?? story.firstSeenAt).getTime(),
    Date.now(),
    getLocale(),
  );
  const countsText = (
    <>
      {m.news_reports_count({ count: story.itemCount.toString() })}
      {" · "}
      {m.news_sources_count({ count: story.sourceCount.toString() })}
    </>
  );

  return (
    <article
      className="rise-in group flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-5 shadow-[0_4px_16px_rgba(45,42,36,0.08)] transition-all hover:-translate-y-1 hover:shadow-[0_12px_32px_rgba(139,111,71,0.16)] sm:p-6"
      style={{ animationDelay: delay }}
    >
      {/* 标题+摘要整块可点进详情;footer 的外链留在 Link 外,互不干扰 */}
      <Link
        to="/news/$shortId"
        params={{ shortId: story.shortId }}
        className="block no-underline"
      >
        <h3 className="line-clamp-2 font-serif text-lg font-semibold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)] sm:text-xl">
          {story.title}
        </h3>
        {story.summary ? (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[var(--ink-soft)]">
            {story.summary}
          </p>
        ) : null}
      </Link>

      {visibleTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {visibleTags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="border-[var(--line)] px-2 py-0.5 text-[11px] font-normal text-[var(--ink-soft)]"
            >
              #{tag}
            </Badge>
          ))}
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--line)] pt-3 text-xs text-[var(--ink-soft)]">
        {/* 签名元素:来源 favicon 叠放,一眼看出多源报道 */}
        {domains.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="flex -space-x-1.5">
              {domains.map((domain) => (
                <img
                  key={domain}
                  src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                  alt=""
                  loading="lazy"
                  className="h-4 w-4 rounded-full bg-[var(--bg)] ring-2 ring-[var(--surface-strong)]"
                />
              ))}
            </span>
            <span>{countsText}</span>
          </span>
        )}
        {domains.length === 0 && <span>{countsText}</span>}
        {showScores && story.scoreMin != null && (
          <ScoreBadge min={story.scoreMin} max={story.scoreMax} />
        )}
        {hn && (
          <a
            href={hn.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 no-underline transition-colors hover:border-[var(--academic-brown)] hover:text-[var(--academic-brown)]"
          >
            <MessageSquare className="h-3 w-3" />
            {m.news_hn_points({ points: hn.points.toString() })}
            {" · "}
            {m.news_hn_comments({ count: hn.comments.toString() })}
          </a>
        )}
        {typeof xAccounts === "number" && xAccounts > 0 && (
          <span>{m.news_x_mentions({ count: xAccounts.toString() })}</span>
        )}
        <span className="ml-auto inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <time>{timeAgo}</time>
        </span>
      </footer>
    </article>
  );
}

export function StoryCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-5 shadow-[0_4px_16px_rgba(45,42,36,0.08)] sm:p-6">
      <Skeleton className="h-6 w-4/5" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="flex items-center gap-3 border-t border-[var(--line)] pt-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="ml-auto h-3 w-14" />
      </div>
    </div>
  );
}
