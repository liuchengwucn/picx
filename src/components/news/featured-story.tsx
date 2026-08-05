import { Link } from "@tanstack/react-router";
import { type NewsListStory, StoryMeta } from "#/components/news/story-row";

interface FeaturedStoryProps {
  story: NewsListStory;
  showScores?: boolean;
}

// 每日头条:大字号 + 3 行摘要 + 封面图。移动端图置顶全宽 16:9;sm 起图移到右侧固定宽度
// (DOM 图在文字前 + sm:order-last,保证无图布局时文字自然占满整行)。
export function FeaturedStory({ story, showScores }: FeaturedStoryProps) {
  const { leadImage } = story;

  return (
    <article className="group flex flex-col gap-3 border-b border-[var(--line)] pb-5 pt-2 sm:flex-row sm:gap-5">
      {leadImage ? (
        <img
          src={leadImage.url}
          alt=""
          loading="lazy"
          width={leadImage.width}
          height={leadImage.height}
          className="aspect-video w-full rounded-xl border border-[var(--line)] object-cover sm:order-last sm:aspect-auto sm:h-28 sm:w-44 sm:shrink-0"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <Link
          to="/news/$shortId"
          params={{ shortId: story.shortId }}
          className="block no-underline"
        >
          <h2 className="font-serif text-xl font-bold leading-tight text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)] sm:text-2xl">
            {story.title}
          </h2>
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
