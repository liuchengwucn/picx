import { Quote } from "lucide-react";
import type { RefObject } from "react";
import { SelectionActionBubble } from "#/components/selection/selection-action-bubble";
import { m } from "#/paraglide/messages";
import { encodeAnchor } from "./quote-anchor";
import { buildCardContent, type CardContent } from "./quote-card-content";
import { useQuoteAnchorScroll } from "./use-quote-anchor-scroll";
import { useSelectionBubble } from "./use-selection-bubble";

/** reader 侧交给页面层的东西：锚点串（页面层负责拼成 URL）+ 卡片正文 */
export interface ReaderSharePayload {
  anchorParam: string;
  content: CardContent | null;
}

/**
 * 把「选中 → 气泡」这套挂载收在一个组件里，免得 ReaderArticle 为了接线而不断膨胀。
 * ReaderArticle 只需要把 articleRef 交出来，气泡状态都归这里管；弹窗本身在页面级
 * （见 useQuoteShare），这里只负责把锚点串与卡片正文交上去。
 *
 * contentKey 用于驱动 useQuoteAnchorScroll：正文重新挂载/内容变化时重跑一次深链定位。
 */
export function QuoteShareOverlay({
  articleRef,
  onShare,
  contentKey,
}: {
  articleRef: RefObject<HTMLElement | null>;
  /** 点「分享这段」时把算好的锚点串与卡片正文交给页面层 */
  onShare: (payload: ReaderSharePayload) => void;
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
                const anchor = bubble.state?.anchor ?? null;
                const article = articleRef.current;
                if (anchor && article) {
                  onShare({
                    anchorParam: encodeAnchor(anchor),
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
