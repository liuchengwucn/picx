import { Link } from "@tanstack/react-router";
import { type NewsListStory, StoryMeta } from "#/components/news/story-row";

interface FeaturedStoryProps {
  story: NewsListStory;
  showScores?: boolean;
  // 首屏头条传 true 走 eager 加载,避免 LCP 图被懒加载拖慢
  eager?: boolean;
}

// 每日头条:大字号 + 3 行摘要 + 封面图。移动端图置顶全宽 16:9;sm 起图移到右侧固定宽度。
// DOM 图放在文字前是为了移动端天然按源码顺序置顶,免加 order 工具类;sm:order-last 再把它挪到桌面右侧。
export function FeaturedStory({
  story,
  showScores,
  eager,
}: FeaturedStoryProps) {
  const { leadImage } = story;

  return (
    <article className="flex flex-col gap-3 border-b border-[var(--line)] pb-5 pt-2 sm:flex-row sm:gap-5">
      {leadImage ? (
        <img
          // key 强制换图时重挂载:onError 的 display:none 是命令式内联样式,
          // React 复用 DOM 节点时不会清除,会把上一张坏图的隐藏带给新图
          key={leadImage.url}
          src={leadImage.url}
          alt=""
          loading={eager ? "eager" : "lazy"}
          referrerPolicy="no-referrer"
          width={leadImage.width}
          height={leadImage.height}
          className="aspect-video w-full rounded-xl border border-[var(--line)] object-cover sm:order-last sm:aspect-auto sm:h-28 sm:w-44 sm:shrink-0"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <Link
          to="/news/$shortId"
          params={{ shortId: story.shortId }}
          className="group block no-underline"
        >
          <h3 className="font-serif text-xl font-bold leading-tight text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)] sm:text-2xl">
            {story.title}
          </h3>
          {story.summary ? (
            <p className="mt-2 line-clamp-3 text-[15px] leading-relaxed text-[var(--ink-soft)]">
              {story.summary}
            </p>
          ) : null}
        </Link>
        <StoryMeta story={story} showScores={showScores} className="mt-2.5" />
      </div>
    </article>
  );
}
