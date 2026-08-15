import { useCallback, useState } from "react";
import type { NewsMedia } from "#/db/schema";
import { displayImageUrl, needsImageProxy } from "#/lib/news/image-source";

interface StoryImageProps {
  media: NewsMedia;
  /** 首屏图（LCP 候选）传 true 走 eager，其余懒加载 */
  eager?: boolean;
  className?: string;
}

/**
 * 新闻配图的唯一渲染口。取不到图时**整个元素消失**（返回 null，连带外边距一起没有），
 * 而不是留一个 0 内容的坏图框。
 *
 * 只靠 `onError` 是不够的，这是本组件存在的根本原因：
 * 首页 / 列表页都是 SSR 直出，`<img>` 在首屏 HTML 里，浏览器一解析到就开始下载；
 * 而 React 的 onError 监听器要等 bundle 下载完、hydration 跑到这个节点才挂上去。
 * **图片的错误若早于 hydration 返回，error 事件就永久丢失**，框子再也不会被摘掉。
 * 线上实测（同一页面只改 JS 到达时间）：不延迟 JS 时图框正常消失，把 JS 延迟 4s 后
 * 坏图框 292×164 稳定留在页面上——「刷新有时就好了」正是这个竞态的表现（bundle 命中
 * 缓存时 hydration 抢赢）。iOS Safari 还会把坏图按 1:1 撑开（实测 268×268），
 * 在手机上直接占掉一屏。
 *
 * 所以挂载时必须主动补检 `complete && naturalWidth === 0`：这个组合的语义是
 * 「加载已经结束，但没有任何像素」，即已经失败了，无论 error 事件有没有被听到。
 * onError 仍然保留，负责「挂载之后才失败」的那一半情况。
 *
 * 契约：换图不在组件内部重置，调用方需挂 `key={media.url}` 让组件重挂载。
 */
export function StoryImage({ media, eager, className }: StoryImageProps) {
  const [failed, setFailed] = useState(false);

  // ref callback 在 commit 阶段就跑（早于 effect），能赶在浏览器绘制前把坏图摘掉
  const probeOnMount = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return null;

  // 走代理的是同源请求，referrerPolicy 没有意义；不走代理的必须带 no-referrer——
  // 微信图床（mmbiz.qpic.cn）见到非微信 Referer 会回一张 2KB 占位图，不带才给真图。
  const proxied = needsImageProxy(media.url);

  return (
    <img
      ref={probeOnMount}
      src={displayImageUrl(media.url)}
      alt=""
      loading={eager ? "eager" : "lazy"}
      referrerPolicy={proxied ? undefined : "no-referrer"}
      // width/height 只为占位防抖动：Tailwind preflight 的 `img { height: auto }`
      // 是作者样式，会盖掉 height 属性的表现性提示，所以调用点的 aspect-video 照常生效，
      // 属性本身只剩「提供固有宽高比」这一个作用。
      width={media.width}
      height={media.height}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
