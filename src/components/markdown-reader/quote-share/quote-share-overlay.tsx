import type { RefObject } from "react";
import { useMemo, useState } from "react";
import { paperQuoteUrl } from "#/lib/embed-code";
import { encodeAnchor, type QuoteAnchor } from "./quote-anchor";
import { buildCardContent } from "./quote-card-content";
import { QuoteShareBubble } from "./quote-share-bubble";
import { type QuoteShareContext, QuoteShareDialog } from "./quote-share-dialog";
import { useQuoteAnchorScroll } from "./use-quote-anchor-scroll";
import { useSelectionBubble } from "./use-selection-bubble";

/**
 * 把「选中 → 气泡 → 弹窗」这一整套挂载收在一个组件里，免得 ReaderArticle 为了接线
 * 而不断膨胀（后续还要加卡片生成、截图、未公开提示）。ReaderArticle 只需要把
 * articleRef 与 share 交出来，其余状态都归这里管。
 *
 * contentKey 用于驱动 useQuoteAnchorScroll：正文重新挂载/内容变化时重跑一次深链定位。
 */
export function QuoteShareOverlay({
  articleRef,
  share,
  contentKey,
}: {
  articleRef: RefObject<HTMLElement | null>;
  share: QuoteShareContext;
  contentKey: string;
}) {
  const [shareAnchor, setShareAnchor] = useState<QuoteAnchor | null>(null);
  const bubble = useSelectionBubble(articleRef);
  useQuoteAnchorScroll(articleRef, contentKey);

  const cardContent = useMemo(() => {
    const article = articleRef.current;
    if (!shareAnchor || !article) {
      return null;
    }
    return buildCardContent(article, shareAnchor);
  }, [shareAnchor, articleRef]);

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
        content={cardContent}
        title={share.title}
      />
    </>
  );
}
