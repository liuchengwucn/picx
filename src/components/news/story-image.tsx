import { SelfHidingImage } from "#/components/self-hiding-image";
import type { NewsMedia } from "#/db/schema";
import { displayImageUrl, needsImageProxy } from "#/lib/news/image-source";

interface StoryImageProps {
  media: NewsMedia;
  /** 首屏图（LCP 候选）传 true 走 eager，其余懒加载 */
  eager?: boolean;
  className?: string;
}

/**
 * 新闻配图的唯一渲染口。非 image 类型的 media 不渲染；能渲染的交给
 * SelfHidingImage——「取不到图就整个消失」以及那条 hydration 竞态的来龙去脉都在
 * 那个原语里写着，这里不复述。
 */
export function StoryImage({ media, eager, className }: StoryImageProps) {
  if (media.type !== "image") return null;

  // 走代理的是同源请求，referrerPolicy 没有意义；不走代理的必须带 no-referrer——
  // 微信图床（mmbiz.qpic.cn）见到非微信 Referer 会回一张 2KB 占位图，不带才给真图。
  const proxied = needsImageProxy(media.url);

  return (
    <SelfHidingImage
      src={displayImageUrl(media.url)}
      // 身份键用原始 url 而不是改写后的 src：判「是不是换了一张图」是调用方的语义
      identity={media.url}
      eager={eager}
      referrerPolicy={proxied ? undefined : "no-referrer"}
      width={media.width}
      height={media.height}
      className={className}
    />
  );
}
