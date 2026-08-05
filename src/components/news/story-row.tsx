import { Link } from "@tanstack/react-router";
import { Clock, MessageSquare } from "lucide-react";
import { ScoreBadge } from "#/components/news/score-badge";
import { Skeleton } from "#/components/ui/skeleton";
import type { NewsMedia, StorySignalsSummary } from "#/db/schema";
import { formatRelative } from "#/lib/relative-time";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

export interface NewsListStory {
  shortId: string;
  title: string;
  summary: string;
  itemCount: number;
  sourceCount: number;
  signalsSummary: StorySignalsSummary | null;
  firstSeenAt: Date | string;
  earliestPublishedAt: Date | string | null;
  lastActivityAt: Date;
  scoreMin: number | null;
  scoreMax: number | null;
  leadImage: NewsMedia | null;
}

// 来源 favicon 叠放上限:超过 5 个只显示前 5,数量交给文字计数表达
const MAX_FAVICONS = 5;

interface StoryMetaProps {
  story: NewsListStory;
  showScores?: boolean;
  className?: string;
}

// 无框列表共享的元信息行:favicon 叠放 + 篇数/来源数 + debug 分数 + HN pill + 相对时间。
// 页面无卡片底色,favicon 描边用 --bg 而不是旧 story-card 的 --surface-strong。
export function StoryMeta({ story, showScores, className }: StoryMetaProps) {
  const domains = story.signalsSummary?.domains?.slice(0, MAX_FAVICONS) ?? [];
  const hn = story.signalsSummary?.hn;
  const xAccounts = story.signalsSummary?.xAccounts;
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
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--ink-soft)] ${className ?? ""}`}
    >
      {domains.length > 0 ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="flex -space-x-1.5">
            {domains.map((domain) => (
              <img
                key={domain}
                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                alt=""
                loading="lazy"
                className="h-4 w-4 rounded-full bg-[var(--bg)] ring-2 ring-[var(--bg)]"
              />
            ))}
          </span>
          <span>{countsText}</span>
        </span>
      ) : (
        <span>{countsText}</span>
      )}
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
    </div>
  );
}

interface StoryRowProps {
  story: NewsListStory;
  showScores?: boolean;
  className?: string;
}

// 无框行:衬线标题 + 双行摘要 + 元信息行,下边框细线分隔,不再用卡片
export function StoryRow({ story, showScores, className }: StoryRowProps) {
  return (
    <article
      className={`group border-b border-[var(--line)] py-3.5 ${className ?? ""}`}
    >
      <Link
        to="/news/$shortId"
        params={{ shortId: story.shortId }}
        className="block no-underline"
      >
        <h3 className="font-serif text-[14.5px] font-bold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)]">
          {story.title}
        </h3>
        {story.summary ? (
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-[var(--ink-soft)]">
            {story.summary}
          </p>
        ) : null}
      </Link>
      <StoryMeta story={story} showScores={showScores} className="mt-1.5" />
    </article>
  );
}

export function StoryRowSkeleton() {
  return (
    <div className="border-b border-[var(--line)] py-3.5">
      <Skeleton className="h-4 w-4/5" />
      <div className="mt-2 space-y-1.5">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="ml-auto h-3 w-12" />
      </div>
    </div>
  );
}
