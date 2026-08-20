import type { CSSProperties } from "react";
import { useCallback, useState } from "react";

/**
 * 取不到图时**整个元素消失**（返回 null，连带外边距一起没有），而不是留一个 0 内容
 * 的坏图框。全站每一个可能 404 的 `<img>` 都该走这里，别再各写一份。
 *
 * 只靠 `onError` 是不够的，这是本组件存在的根本原因：
 * 首页 / 列表页 / 周刊都是 SSR 直出，`<img>` 在首屏 HTML 里，浏览器一解析到就开始
 * 下载；而 React 的 onError 监听器要等 bundle 下载完、hydration 跑到这个节点才挂上去。
 * **图片的错误若早于 hydration 返回，error 事件就永久丢失**，框子再也不会被摘掉。
 * 本地 E2E 实测（同一页面只改 JS 到达时间，尺寸与线上原始测量一致）：不延迟 JS 时
 * 图框正常消失，把 JS 延迟 4s 后坏图框 292×164 稳定留在页面上——修复后同样条件下
 * 图片错误比 bundle 早到 4.04s，而卡片里的 img 数为 0。
 * 「刷新有时就好了」正是这个竞态的表现（bundle 命中缓存时 hydration 抢赢）。
 * iOS Safari 还会把坏图按 1:1 撑开（实测 268×268），在手机上直接占掉一屏。
 *
 * 所以挂载时必须主动补检 `complete && naturalWidth === 0`：这个组合的语义是
 * 「加载已经结束，但没有任何像素」，即已经失败了，无论 error 事件有没有被听到。
 * onError 仍然保留，负责「挂载之后才失败」的那一半情况。
 *
 * 返回值必须保持「裸 `<img>` 或 null」这个形状，别在外面包元素（骨架、角标、比例盒
 * 都算）：首页的头条卡与论文卡都用 `has-[>img]:grow` 判断图这一刻还在不在，据此决定
 * 这块要不要吃掉卡片余量（见 components/home/today-strip.tsx，头条卡经 StoryImage
 * 间接用到，那边也留了一份同源说明）。一旦多出一层包裹，那两条选择器恒不命中、卡片
 * 悄悄退回底部带空洞的旧形态——tsc 与单测都看不见，只有开浏览器才发现。真要加包裹层，
 * 必须同步改那两处选择器。
 *
 * 行为被 news/story-image.test.tsx 的 9 个用例钉住（含 hydrateRoot 那条真实路径）。
 * 待迁移站点：components/digest/digest-paper-card.tsx 的 Thumbnail 还是裸 `<img>`，
 * 完全没有这套防护，下次动那个文件时顺手换过来。
 */
export interface SelfHidingImageProps {
  src: string;
  /**
   * 失败记忆的身份键，默认取 src。当 src 会被加工（如走代理改写）时传原始 url，
   * 让「换的是不是同一张图」这件事按调用方的语义判定。
   */
  identity?: string;
  /** 首屏图（LCP 候选）传 true 走 eager，其余懒加载 */
  eager?: boolean;
  /** 默认空 alt：多数调用点图旁边就是标题，念一遍只是噪音。装饰以外的图请显式传。 */
  alt?: string;
  className?: string;
  style?: CSSProperties;
  /** 只为占位防抖动，给浏览器一个固有宽高比 */
  width?: number;
  height?: number;
  referrerPolicy?: "no-referrer";
}

export function SelfHidingImage({
  src,
  identity = src,
  eager,
  alt = "",
  className,
  style,
  width,
  height,
  referrerPolicy,
}: SelfHidingImageProps) {
  // 记「哪一张失败了」而不是一个裸布尔：同一个组件实例换图时失败态必须自动作废。
  // 若做成布尔并要求调用方挂 key，忘挂就是静默失效——新图永远不显示且不报任何错。
  const [failed, setFailed] = useState<string | null>(null);
  // 换图时顺手清空这份记忆（渲染期 setState，React 会立刻重渲染，不进 effect）：
  // 只靠下面的 `failed === identity` 也够挡当前这张图，但记忆留着的话，
  // 「A 失败 → 切到 B → 再切回 A」会直接不渲染 A 而不给它重试的机会，
  // 白白吞掉一次瞬时失败（换 key 重挂载的老写法本来是会重试的）。这一行别删。
  if (failed !== null && failed !== identity) setFailed(null);

  // ref callback 在 commit 阶段就跑（早于 effect），能赶在浏览器绘制前把坏图摘掉：
  // 此时 React 的更新优先级是 SyncLane，这次 setState 会在同一个同步任务里冲刷完，
  // 浏览器没有机会在任务中途绘制，因此不会闪一帧坏图（useEffect 则会——passive effect
  // 排在 requestPaint 之后，可以被绘制打断）。
  // 隐性前提：仓库没有启用 React ViewTransitions。一旦启用，flushSpawnedWork 会被推迟到
  // PENDING_AFTER_MUTATION_PHASE，上面这条 pre-paint 保证就不再成立，需要重新验证。
  //
  // 依赖 identity 是必需的：换图时 React 会 old(null) → new(node) 重新 attach，补检
  // 跟着重跑一次。那一刻新 src 才刚开始加载（complete 为 false），补检正确地 no-op，
  // 后续失败交给 onError。
  const probeOnMount = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && img.naturalWidth === 0) setFailed(identity);
    },
    [identity],
  );

  if (failed === identity) return null;

  return (
    <img
      ref={probeOnMount}
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      referrerPolicy={referrerPolicy}
      // width/height 只为占位防抖动：Tailwind preflight 的 `img { height: auto }`
      // 是作者样式，会盖掉 height 属性的表现性提示，所以调用点的 aspect-video 照常生效，
      // 属性本身只剩「提供固有宽高比」这一个作用。
      width={width}
      height={height}
      className={className}
      style={style}
      onError={() => setFailed(identity)}
    />
  );
}
