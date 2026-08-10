import type { RefObject } from "react";
import { useMemo } from "react";
import {
  type SelectionRect,
  useSelectionRect,
} from "#/hooks/use-selection-rect";
import { type QuoteAnchor, rangeToAnchor } from "./quote-anchor";

export interface SelectionBubbleState {
  anchor: QuoteAnchor;
  /** 视口坐标：气泡用 position:fixed，直接吃 getClientRects 的值 */
  rect: SelectionRect;
}

/**
 * 「选中分享」的气泡状态：通用的选中监听（useSelectionRect）之上，补一个 markdown
 * 深链锚点。锚点解析不出来（例如选区只碰到了图片块、或端点倒挂）就不出气泡。
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
    if (!state || !article) return null;
    const anchor = rangeToAnchor(article, state.range);
    return anchor ? { anchor, rect: state.rect } : null;
  }, [state, articleRef]);

  return { state: bubbleState, dismiss };
}
