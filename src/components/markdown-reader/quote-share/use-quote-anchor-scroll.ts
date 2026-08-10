import type { RefObject } from "react";
import { useEffect } from "react";
import { toast } from "sonner";
import { m } from "#/paraglide/messages";
import { anchorToRange, decodeAnchor } from "./quote-anchor";

const HIGHLIGHT_NAME = "picx-quote";
const HIGHLIGHT_MS = 3000;

/**
 * 已经定位过的锚点。tab 切到总结再切回来会让 <article> 重挂、contentKey 变化、effect
 * 重跑——但用户并没有再次点开链接，不该被重新滚动并再弹一次 toast。
 *
 * 放在模块作用域而不是 ref：QuoteShareOverlay 会随 ReaderArticle 一起卸载，ref 存不住。
 * 整页刷新时这个 Set 自然清空，所以直接访问深链仍然照常定位。
 * key 带上 pathname，免得不同论文碰巧用了同一个锚点串时互相干扰。
 */
const located = new Set<string>();

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
 * contentKey 变化（正文重挂或 markdown 变化）时重跑。react-markdown 的 Markdown 组件
 * 靠 processor.runSync(...) 同步跑完整条 remark/rehype 管线（含 rehype-katex），
 * 首帧 DOM 提交前公式就已经渲染好；React 又保证 ref 回调（layout 阶段）先于 passive
 * effect 执行，所以 effect body 跑的时候 articleRef.current 理论上已经是就绪节点，
 * 不存在「等 KaTeX 异步渲染完」这回事。这里的 rAF + 300ms 重试只是廉价兜底（万一
 * anchorToRange 因为别的原因暂时定位不到），失败两次就放弃并留一条日志。
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
    const key = `${window.location.pathname}${window.location.hash}`;
    if (located.has(key)) {
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
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
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
      located.add(key);
      toast.success(m.quote_share_located());
      return true;
    };

    frame = requestAnimationFrame(() => {
      frame = null;
      if (attempt()) {
        return;
      }
      // 首帧理论上已经就绪（见上），这次重试只是兜底，不是在等某个异步渲染阶段
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!attempt()) {
          // 深链失效对用户表现为「点了没反应」，留一条线索方便排查
          console.warn(
            `[quote-anchor] failed to locate shared passage: ${window.location.hash}`,
          );
        }
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
      // clearHighlight 自己会顺带清掉 clearTimer，这里不用重复判空清一遍
      clearHighlight();
    };
  }, [articleRef, contentKey]);
}
