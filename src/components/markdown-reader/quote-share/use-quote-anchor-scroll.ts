import type { RefObject } from "react";
import { useEffect } from "react";
import { toast } from "sonner";
import { m } from "#/paraglide/messages";
import { anchorToRange, decodeAnchor } from "./quote-anchor";

const HIGHLIGHT_NAME = "picx-quote";
const HIGHLIGHT_MS = 3000;

/** CSS Custom Highlight API 在旧浏览器上不存在；不支持时只滚动、不高亮。 */
function highlightsSupported(): boolean {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight !== "undefined"
  );
}

/**
 * 分享深链落地：解析 hash 里的锚点 → 定位 → 滚动 → 高亮渐隐。
 *
 * contentKey 变化（正文重挂或 markdown 变化）时重跑。定位要等 KaTeX 渲染完成才准，
 * 因此先延一帧试一次，失败后再延 300ms 补一次；两次都不中就静默放弃，页面照常展示。
 */
export function useQuoteAnchorScroll(
  articleRef: RefObject<HTMLElement | null>,
  contentKey: string,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: contentKey 只用于驱动重跑（正文重新挂载后需要重新定位），本身不在闭包里读取
  useEffect(() => {
    const anchor = decodeAnchor(window.location.hash);
    if (!anchor) {
      return;
    }

    let cancelled = false;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let frame: number | null = null;

    const clearHighlight = () => {
      if (highlightsSupported()) {
        CSS.highlights.delete(HIGHLIGHT_NAME);
      }
      window.removeEventListener("wheel", clearHighlight);
      window.removeEventListener("touchmove", clearHighlight);
    };

    const attempt = (): boolean => {
      const article = articleRef.current;
      if (!article || cancelled) {
        return false;
      }
      const range = anchorToRange(article, anchor);
      if (!range) {
        return false;
      }

      const target =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as Element)
          : range.startContainer.parentElement;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });

      if (highlightsSupported()) {
        CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
        // 用户主动滚动即视为「已经看到了」，立刻收掉高亮
        window.addEventListener("wheel", clearHighlight, { once: true });
        window.addEventListener("touchmove", clearHighlight, { once: true });
        clearTimer = setTimeout(clearHighlight, HIGHLIGHT_MS);
      }
      toast.success(m.quote_share_located());
      return true;
    };

    frame = requestAnimationFrame(() => {
      frame = null;
      if (attempt()) {
        return;
      }
      // KaTeX 渲染会改变布局与节点结构，给它一次补机会
      retryTimer = setTimeout(() => {
        retryTimer = null;
        attempt();
      }, 300);
    });

    return () => {
      cancelled = true;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      if (clearTimer) {
        clearTimeout(clearTimer);
      }
      clearHighlight();
    };
  }, [articleRef, contentKey]);
}
