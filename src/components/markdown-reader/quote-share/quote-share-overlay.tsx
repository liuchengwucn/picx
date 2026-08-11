import { Quote } from "lucide-react";
import type { RefObject } from "react";
import { SelectionActionBubble } from "#/components/selection/selection-action-bubble";
import { paperQuoteUrl } from "#/lib/embed-code";
import { m } from "#/paraglide/messages";
import { encodeAnchor } from "./quote-anchor";
import { buildCardContent } from "./quote-card-content";
import { useQuoteAnchorScroll } from "./use-quote-anchor-scroll";
import type { QuoteSharePayload } from "./use-quote-share";
import { useSelectionBubble } from "./use-selection-bubble";

/**
 * 把「选中 → 气泡」这套挂载收在一个组件里，免得 ReaderArticle 为了接线而不断膨胀。
 * ReaderArticle 只需要把 articleRef 交出来，气泡状态都归这里管；弹窗本身在页面级
 * （见 useQuoteShare），这里只负责把算好的深链与卡片正文交上去。
 *
 * 深链在这里就拼成成品 url（而不是交出锚点串让页面拼）：每个视图的深链形状不同，
 * 交出成品才不用逼页面按视图分支。paperQuoteUrl 是纯函数，与页面和 tRPC 都无耦合。
 *
 * contentKey 用于驱动 useQuoteAnchorScroll：正文重新挂载/内容变化时重跑一次深链定位。
 */
export function QuoteShareOverlay({
  articleRef,
  shortId,
  onShare,
  contentKey,
}: {
  articleRef: RefObject<HTMLElement | null>;
  shortId: string;
  /** 点「分享这段」时把算好的深链与卡片正文交给页面层 */
  onShare: (payload: QuoteSharePayload) => void;
  contentKey: string;
}) {
  const bubble = useSelectionBubble(articleRef);
  useQuoteAnchorScroll(articleRef, contentKey);

  return (
    <>
      {/* SSR 安全：bubble.state 初始为 null，只在 useSelectionBubble 的
          useEffect 挂上的事件监听器里才会被置为非 null，服务端渲染与客户端首帧都
          不会执行到这个分支。 */}
      {bubble.state && (
        <SelectionActionBubble
          rect={bubble.state.rect}
          actions={[
            {
              key: "share",
              icon: Quote,
              label: m.selection_share(),
              onClick: () => {
                // buildCardContent 只由这次点击驱动，不是渲染期间要保持的派生值——
                // 直接在事件回调里算完交出去，不用 useMemo（读 ref 也不该发生在
                // render 期间）。
                const anchor = bubble.state?.anchor ?? null;
                const article = articleRef.current;
                if (anchor && article) {
                  onShare({
                    url: paperQuoteUrl(shortId, encodeAnchor(anchor)),
                    content: buildCardContent(article, anchor),
                  });
                }
                bubble.dismiss();
              },
            },
          ]}
        />
      )}
    </>
  );
}
