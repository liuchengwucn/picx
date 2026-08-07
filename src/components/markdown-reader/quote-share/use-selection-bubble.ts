import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type QuoteAnchor, rangeToAnchor } from "./quote-anchor";

export interface SelectionBubbleState {
  anchor: QuoteAnchor;
  /** 视口坐标：气泡用 position:fixed，直接吃 getClientRects 的值 */
  rect: { top: number; bottom: number; centerX: number };
}

/**
 * 监听正文里的文本选中，产出气泡所需的锚点与坐标。
 *
 * 三个信号缺一不可：selectionchange 覆盖键盘选中与双击选词；pointerdown/up 用来在
 * 拖拽过程中压住气泡(否则拖选时气泡会跟着乱跳)；scroll/resize 用来重算坐标。
 * 全部经 rAF 合流，避免拖选时每像素一次布局读取。
 */
export function useSelectionBubble(articleRef: RefObject<HTMLElement | null>): {
  state: SelectionBubbleState | null;
  dismiss: () => void;
} {
  const [state, setState] = useState<SelectionBubbleState | null>(null);
  const draggingRef = useRef(false);
  const frameRef = useRef<number | null>(null);

  const evaluate = useCallback(() => {
    const article = articleRef.current;
    const selection = document.getSelection();
    if (!article || !selection || selection.rangeCount === 0) {
      setState(null);
      return;
    }
    if (selection.isCollapsed) {
      setState(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const anchor = rangeToAnchor(article, range);
    if (!anchor) {
      setState(null);
      return;
    }
    const rects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 0 || r.height > 0,
    );
    const last = rects[rects.length - 1];
    if (!last || last.bottom < 0 || last.top > window.innerHeight) {
      setState(null);
      return;
    }
    setState({
      anchor,
      rect: {
        top: last.top,
        bottom: last.bottom,
        centerX: last.left + last.width / 2,
      },
    });
  }, [articleRef]);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (!draggingRef.current) {
        evaluate();
      }
    });
  }, [evaluate]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // 点在气泡自己身上不算重新拖选，否则按钮会在 pointerdown 阶段就被卸载、click 永远不触发
      if (target?.closest?.("[data-quote-bubble]")) {
        return;
      }
      draggingRef.current = true;
      setState(null);
    };
    // pointerup 之外还要兜底 pointercancel 与 blur：拖到窗口外再松手（触控板/鼠标
    // 移出窗口）、触控笔中途取消、拖拽过程中窗口失焦，都不会给 document 发 pointerup，
    // draggingRef 会永远卡在 true。而 schedule() 里 `!draggingRef.current` 这道门连
    // selectionchange（键盘 Shift+方向键选中）也一起挡住，纯键盘用户会因此看起来
    // 「选中分享」整个失效，直到随便点一下页面才能自愈——所以必须主动兜底，不能指望
    // pointerup 总会到达。
    const endDrag = () => {
      draggingRef.current = false;
      schedule();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setState(null);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
    document.addEventListener("selectionchange", schedule);
    document.addEventListener("keydown", onKeyDown);
    // capture:true —— 正文在可滚动容器里时，事件不冒泡到 window
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.addEventListener("blur", endDrag);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("blur", endDrag);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [schedule]);

  const dismiss = useCallback(() => setState(null), []);
  return { state, dismiss };
}
