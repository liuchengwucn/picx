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
 * 而不是留一个 0 内容的坏图框。非 image 类型的 media 同样不渲染。
 *
 * 只靠 `onError` 是不够的，这是本组件存在的根本原因：
 * 首页 / 列表页都是 SSR 直出，`<img>` 在首屏 HTML 里，浏览器一解析到就开始下载；
 * 而 React 的 onError 监听器要等 bundle 下载完、hydration 跑到这个节点才挂上去。
 * **图片的错误若早于 hydration 返回，error 事件就永久丢失**，框子再也不会被摘掉。
 * 本地 E2E 实测（同一页面只改 JS 到达时间，尺寸与线上原始测量一致）：不延迟 JS 时
 * 图框正常消失，把 JS 延迟 4s 后坏图框 292×164 稳定留在页面上——修复后同样条件下
 * 图片错误比 bundle 早到 4.04s，而卡片里的 img 数为 0。
 * 「刷新有时就好了」正是这个竞态的表现（bundle 命中
 * 缓存时 hydration 抢赢）。iOS Safari 还会把坏图按 1:1 撑开（实测 268×268），
 * 在手机上直接占掉一屏。
 *
 * 所以挂载时必须主动补检 `complete && naturalWidth === 0`：这个组合的语义是
 * 「加载已经结束，但没有任何像素」，即已经失败了，无论 error 事件有没有被听到。
 * onError 仍然保留，负责「挂载之后才失败」的那一半情况。
 */
export function StoryImage({ media, eager, className }: StoryImageProps) {
  // 记「哪个 url 失败了」而不是一个裸布尔：同一个组件实例换图时失败态必须自动作废。
  // 若做成布尔并要求调用方挂 key，忘挂就是静默失效——新图永远不显示且不报任何错。
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // 换图时顺手清空这份记忆（渲染期 setState，React 会立刻重渲染，不进 effect）：
  // 只靠下面的 `failedUrl === media.url` 也够挡当前这张图，但记忆留着的话，
  // 「A 失败 → 切到 B → 再切回 A」会直接不渲染 A 而不给它重试的机会，
  // 白白吞掉一次瞬时失败（换 key 重挂载的老写法本来是会重试的）。
  if (failedUrl !== null && failedUrl !== media.url) setFailedUrl(null);

  // ref callback 在 commit 阶段就跑（早于 effect），能赶在浏览器绘制前把坏图摘掉：
  // 此时 React 的更新优先级是 SyncLane，这次 setState 会在同一个同步任务里冲刷完，
  // 浏览器没有机会在任务中途绘制，因此不会闪一帧坏图（useEffect 则会——passive effect
  // 排在 requestPaint 之后，可以被绘制打断）。
  // 隐性前提：仓库没有启用 React ViewTransitions。一旦启用，flushSpawnedWork 会被推迟到
  // PENDING_AFTER_MUTATION_PHASE，上面这条 pre-paint 保证就不再成立，需要重新验证。
  //
  // 依赖 media.url 是必需的：换图时 React 会 old(null) → new(node) 重新 attach，补检
  // 跟着重跑一次。那一刻新 src 才刚开始加载（complete 为 false），补检正确地 no-op，
  // 后续失败交给 onError。
  const probeOnMount = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && img.naturalWidth === 0) setFailedUrl(media.url);
    },
    [media.url],
  );

  if (failedUrl === media.url || media.type !== "image") return null;

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
      onError={() => setFailedUrl(media.url)}
    />
  );
}
