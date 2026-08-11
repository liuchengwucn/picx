import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Quote } from "lucide-react";
import type { RefObject } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { SelectionActionBubble } from "#/components/selection/selection-action-bubble";
import { useTRPC } from "#/integrations/trpc/react";
import { paperQuoteUrl } from "#/lib/embed-code";
import { m } from "#/paraglide/messages";
import { encodeAnchor, type QuoteAnchor } from "./quote-anchor";
import { buildCardContent, type CardContent } from "./quote-card-content";
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
  const [cardContent, setCardContent] = useState<CardContent | null>(null);
  const bubble = useSelectionBubble(articleRef);
  useQuoteAnchorScroll(articleRef, contentKey);

  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const togglePublic = useMutation(
    trpc.paper.togglePublic.mutationOptions({
      onSuccess: () => {
        // 详情页的 paper 查询要重取，提示条才会消失
        void queryClient.invalidateQueries({
          queryKey: trpc.paper.getByShortId.queryKey(share.shortId),
        });
      },
      // 这是流程中途的模态决策点，不是设置页的后台动作：静默失败会让用户带着
      // 一条他们以为已经解除、实则仍是死链的分享出门，必须显式提示。
      onError: () => toast.error(m.quote_share_make_public_failed()),
    }),
  );

  return (
    <>
      {/* SSR 安全：bubble.state 初始为 null，只在 useSelectionBubble 的
          useEffect 挂上的事件监听器里才会被置为非 null，服务端渲染与客户端首帧都
          不会执行到这个分支。 */}
      {bubble.state && !shareAnchor && (
        <SelectionActionBubble
          rect={bubble.state.rect}
          actions={[
            {
              key: "share",
              icon: Quote,
              label: m.selection_share(),
              onClick: () => {
                // buildCardContent 只由这次点击驱动，不是渲染期间要保持的派生值——
                // 直接在事件回调里算完存进 state，不用 useMemo（读 ref 也不该发生在
                // render 期间）。
                const anchor = bubble.state?.anchor ?? null;
                const article = articleRef.current;
                setShareAnchor(anchor);
                setCardContent(
                  anchor && article ? buildCardContent(article, anchor) : null,
                );
                bubble.dismiss();
              },
            },
          ]}
        />
      )}

      <QuoteShareDialog
        open={!!shareAnchor}
        onOpenChange={(next) => {
          if (!next) {
            setShareAnchor(null);
            setCardContent(null);
          }
        }}
        url={
          shareAnchor
            ? paperQuoteUrl(share.shortId, encodeAnchor(shareAnchor))
            : ""
        }
        content={cardContent}
        title={share.title}
        share={share}
        publishing={togglePublic.isPending}
        onMakePublic={() => togglePublic.mutate({ paperId: share.paperId })}
      />
    </>
  );
}
