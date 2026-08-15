import { Link } from "@tanstack/react-router";
import { StoryImage } from "#/components/news/story-image";
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
        // key 保证换图时重挂载, 让 StoryImage 的失败态跟着重置
        <StoryImage
          key={leadImage.url}
          media={leadImage}
          eager={eager}
          className="aspect-video w-full rounded-xl border border-[var(--line)] object-cover sm:order-last sm:aspect-auto sm:h-28 sm:w-44 sm:shrink-0"
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

interface SubFeaturedStoryProps {
  story: NewsListStory;
  showScores?: boolean;
}

// 次头条：当天 ≥80 分但非最高分的 story。全宽单列横在大头条与两栏普通行之间，
// 中号衬线标题 + 单行摘要 + 右侧小缩略图，保持大头条唯一的视觉锚点地位。
export function SubFeaturedStory({ story, showScores }: SubFeaturedStoryProps) {
  const { leadImage } = story;

  return (
    <article className="flex gap-4 border-b border-[var(--line)] py-3.5">
      <div className="min-w-0 flex-1">
        <Link
          to="/news/$shortId"
          params={{ shortId: story.shortId }}
          className="group block no-underline"
        >
          <h3 className="font-serif text-lg font-bold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)]">
            {story.title}
          </h3>
          {story.summary ? (
            <p className="mt-1 line-clamp-1 text-sm leading-relaxed text-[var(--ink-soft)]">
              {story.summary}
            </p>
          ) : null}
        </Link>
        <StoryMeta story={story} showScores={showScores} className="mt-2" />
      </div>
      {leadImage ? (
        <StoryImage
          key={leadImage.url}
          media={leadImage}
          className="h-16 w-24 shrink-0 rounded-lg border border-[var(--line)] object-cover sm:h-20 sm:w-32"
        />
      ) : null}
    </article>
  );
}
