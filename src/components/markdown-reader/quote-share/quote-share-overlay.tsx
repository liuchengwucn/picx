import type { RefObject } from "react";
import { useState } from "react";
import { paperQuoteUrl } from "#/lib/embed-code";
import { encodeAnchor, type QuoteAnchor } from "./quote-anchor";
import { QuoteShareBubble } from "./quote-share-bubble";
import { type QuoteShareContext, QuoteShareDialog } from "./quote-share-dialog";
import { useSelectionBubble } from "./use-selection-bubble";

/**
 * 把「选中 → 气泡 → 弹窗」这一整套挂载收在一个组件里，免得 ReaderArticle 为了接线
 * 而不断膨胀（后续还要加卡片生成、截图、未公开提示）。ReaderArticle 只需要把
 * articleRef 与 share 交出来，其余状态都归这里管。
 *
 * contentKey 先收着但本任务不用——Task 3 的落地定位 hook（useQuoteAnchorScroll）
 * 会挂在这里，靠它判断正文是否已重新挂载完成。
 */
export function QuoteShareOverlay({
  articleRef,
  share,
  // 本任务用不上，Task 3 接 useQuoteAnchorScroll(articleRef, contentKey) 时才会用到；
  // 加下划线前缀让 tsc 的 noUnusedParameters 放行，而不是把 prop 从类型里删掉
  contentKey: _contentKey,
}: {
  articleRef: RefObject<HTMLElement | null>;
  share: QuoteShareContext;
  contentKey: string;
}) {
  const [shareAnchor, setShareAnchor] = useState<QuoteAnchor | null>(null);
  const bubble = useSelectionBubble(articleRef);

  return (
    <>
      {bubble.state && !shareAnchor && (
        <QuoteShareBubble
          state={bubble.state}
          onShare={() => {
            setShareAnchor(bubble.state?.anchor ?? null);
            bubble.dismiss();
          }}
        />
      )}

      <QuoteShareDialog
        open={!!shareAnchor}
        onOpenChange={(next) => {
          if (!next) {
            setShareAnchor(null);
          }
        }}
        url={
          shareAnchor
            ? paperQuoteUrl(share.shortId, encodeAnchor(shareAnchor))
            : ""
        }
      />
    </>
  );
}
