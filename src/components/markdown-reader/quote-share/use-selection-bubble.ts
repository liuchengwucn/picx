import type { RefObject } from "react";
import { useMemo } from "react";
import {
  type SelectionRect,
  useSelectionRect,
} from "#/hooks/use-selection-rect";
import { type QuoteAnchor, rangeToAnchor } from "./quote-anchor";

export interface SelectionBubbleState {
  /** 深链锚点。解析不出来时为 null——此时只出「问这段」，不出「分享这段」 */
  anchor: QuoteAnchor | null;
  /** 视口坐标：气泡用 position:fixed，直接吃 getClientRects 的值 */
  rect: SelectionRect;
  /** 已裁剪到 article 之内的选区，「问这段」按它取引文 */
  clippedRange: Range;
}

/**
 * 「选中分享」的气泡状态：通用的选中监听（useSelectionRect）之上，补一个 markdown
 * 深链锚点。锚点解析不出来时气泡照出，只是少「分享这段」这一段操作——没有深链可分享，
 * 但引文照样能送进 chat。触发这种情况的是「块的规范化文本为空、但渲染文本不空」，
 * 典型是 figure + figcaption（图注对渲染文本有贡献，但规范化遍历整块跳过 FIGURE）。
 *
 * 监听逻辑本身在 #/hooks/use-selection-rect —— PDF 的「问这段」用的是同一份底座。
 */
export function useSelectionBubble(articleRef: RefObject<HTMLElement | null>): {
  state: SelectionBubbleState | null;
  dismiss: () => void;
} {
  const { state, dismiss } = useSelectionRect(articleRef);

  // 渲染期读 ref 在这里是安全的：state 只可能由挂载后的事件监听器产出，那时
  // articleRef 早已挂上；而 rangeToAnchor 对同一个（已克隆的静态）Range 是纯函数。
  const bubbleState = useMemo(() => {
    const article = articleRef.current;
    if (!state) return null;
    const anchor = article ? rangeToAnchor(article, state.range) : null;
    return { anchor, rect: state.rect, clippedRange: state.clippedRange };
  }, [state, articleRef]);

  return { state: bubbleState, dismiss };
}
