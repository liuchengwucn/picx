import { Link, useNavigate } from "@tanstack/react-router";
import { Globe, Sparkles, ThumbsUp } from "lucide-react";
import {
  type FeedbackAuthState,
  FeedbackButtons,
} from "#/components/papers/feedback-buttons";
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
  /** 所属跟踪方向; 非方向论文为 null */
  directionSlug?: string | null;
  likeCount?: number;
}

/**
 * 把分类 slug 映射到当前语言的显示名(Paraglide)。
 * message key 约定: category_<slug 连字符转下划线>, 缺失时回退 slug 本身。
 * gallery 列表页与分类落地页共用。
 */
export function getCategoryLabel(slug: string): string {
  return (
    (m as unknown as Record<string, () => string>)[
      `category_${slug.replace(/-/g, "_")}`
    ]?.() ?? slug
  );
}

interface GalleryCardProps {
  paper: GalleryCardPaper;
  delay: string;
  onTagClick?: (tag: string) => void;
  /** 已解析成当前语言的方向名(页面用 digest.listDirections 把 slug 映射出来) */
  directionLabel?: string;
  myVote?: 1 | -1;
  /** 不传 = 不渲染反馈按钮; 没有登录态上下文的复用点就别传 */
  feedbackAuth?: FeedbackAuthState;
  /** 未登录点反馈时登录后要回到的地址; 与 feedbackAuth 同时传才渲染按钮 */
  signInCallbackURL?: string;
}

export function GalleryCard({
  paper,
  delay,
  onTagClick,
  directionLabel,
  myVote,
  feedbackAuth,
  signInCallbackURL,
}: GalleryCardProps) {
  const navigate = useNavigate();
  const imageUrl = `/api/r2/${paper.whiteboardImageR2Key}`;
  const timeAgo = getTimeAgo(paper.publishedAt);
  const visibleTags = paper.tags?.slice(0, 2) ?? [];
  const likeCount = paper.likeCount ?? 0;
  const directionSlug = paper.directionSlug;

  return (
    <Link
      to="/p/$shortId"
      params={{ shortId: paper.shortId }}
      className="rise-in group block no-underline"
      style={{ animationDelay: delay }}
    >
      <article className="relative flex h-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] shadow-[0_4px_16px_rgba(45,42,36,0.08)] transition-all hover:-translate-y-1 hover:shadow-[0_12px_32px_rgba(139,111,71,0.16)]">
        {/* 反馈按钮悬浮在右上角: 常驻会跟标题抢注意力, 所以只在 hover / 键盘聚焦时
            浮现。has-[[data-feedback-open]] 是踩票 popover 打开期间的保命锁——浮层
            portal 到了 body, 指针一移进去卡片就 un-hover, 只写 group-hover 的话
            按钮会连着浮层的锚点一起淡出。(group-focus-within 救不了, 焦点被 Radix
            移进了卡片 DOM 之外。) 移动端没有 hover, 投票走详情页。
            自带一层浅底 + 阴影: 卡片这一角下面压着标题, 没有底会糊在字上。

            pointer-events-none 不是装饰: opacity-0 照样能点, 触屏上点到卡片右上角
            就会命中隐形的赞/踩(未登录直接被弹去 GitHub OAuth, 已登录静默投一票),
            而 handler 里的 preventDefault 还顺手吃掉了整卡跳转。三个显示变体各配一个
            pointer-events-auto: group-hover 那个由卡片(.group)的 hover 驱动, 不依赖
            pill 自己可命中, 所以桌面端不会自锁; pointer-events:none 也不阻止聚焦,
            键盘那条 focus-within 路径照旧。

            这里不再把 pending 排除掉: 排除会让服务端渲染的这一格与客户端首帧不一致
            (session fetch 可能在 hydration 走到本卡之前就落地), 整棵 SSR 子树被丢弃
            重渲。pending 交给 FeedbackButtons 渲染同构的不可投票骨架。 */}
        {feedbackAuth && signInCallbackURL ? (
          <div className="pointer-events-none absolute top-3 right-3 z-10 rounded-full bg-[var(--surface-strong)]/95 p-1 opacity-0 shadow-[0_2px_10px_rgba(45,42,36,0.12)] transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 has-[[data-feedback-open]]:pointer-events-auto has-[[data-feedback-open]]:opacity-100">
            <FeedbackButtons
              paperId={paper.id}
              likeCount={likeCount}
              myVote={myVote}
              auth={feedbackAuth}
              signInCallbackURL={signInCallbackURL}
              variant="card"
              // 赞数由底行那个常驻的负责, pill 只承担操作, 免得 hover 时同一个数字
              // 在卡片上出现两遍
              showCount={false}
            />
          </div>
        ) : null}

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
          {/* 方向徽标。整卡已经是 <Link>, 嵌套 <a> 是无效 HTML, 所以跟下面的 tag
              chips 一样用 button + 逃逸点击自己跳。 */}
          {directionSlug && directionLabel ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigate({
                  to: "/gallery/d/$slug",
                  params: { slug: directionSlug },
                });
              }}
              // 只念方向名听不出点了会怎样, 补一句「查看方向」
              aria-label={m.digest_direction_view({ name: directionLabel })}
              className="w-fit max-w-full truncate rounded-full bg-[var(--parchment-warm)] px-2 py-0.5 text-[11px] font-medium text-[var(--academic-brown)] transition-colors hover:bg-[var(--academic-brown)] hover:text-white"
            >
              {directionLabel}
            </button>
          ) : null}
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
              {/* 赞数常驻(0 不显示): 放在最左, 时间戳仍锚在最右, hover 时中间那句
                  「白板图」淡入不会把数字推来推去 */}
              {likeCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  {/* 图标 + 数字整组藏起来, 单独给读屏一句完整的话: 否则念出来是
                      「5 赞」这种拼接腔 */}
                  <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                  <span aria-hidden="true" className="tabular-nums">
                    {likeCount}
                  </span>
                  <span className="sr-only">
                    {m.feedback_like_count({ count: String(likeCount) })}
                  </span>
                </span>
              )}
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
