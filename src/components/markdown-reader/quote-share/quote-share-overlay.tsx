import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useTRPC } from "#/integrations/trpc/react";
import { paperQuoteUrl } from "#/lib/embed-code";
import { m } from "#/paraglide/messages";
import { encodeAnchor, type QuoteAnchor } from "./quote-anchor";
import { buildCardContent, type CardContent } from "./quote-card-content";
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
      {bubble.state &&
        !shareAnchor &&
        // 必须 portal 到 body：气泡是 position:fixed + 视口坐标，但 .paper-card 上有
        // 无条件的 backdrop-filter（见 styles.css），按 CSS 规范会成为 fixed 后代的
        // 包含块，气泡的视口坐标会被解析进 .paper-card 的盒子里，导致气泡挤成右边缘
        // 竖条、滚动后跑到视口外——不是坐标算错了，是包含块错了。日后若有人「顺手
        // 简化」把这层 portal 去掉，这个 bug 会以极难联想到原因的方式回来。
        // SSR 安全：bubble.state 初始为 null，只在 useSelectionBubble 的
        // useEffect 挂上的事件监听器里才会被置为非 null，服务端渲染与客户端首帧都
        // 不会执行到这个 createPortal 调用，不存在 document 未定义的问题。
        createPortal(
          <QuoteShareBubble
            state={bubble.state}
            onShare={() => {
              // buildCardContent 只由这次点击驱动，不是渲染期间要保持的派生值——直接在
              // 事件回调里算完存进 state，不用 useMemo（读 ref 也不该发生在 render 期间）。
              const anchor = bubble.state?.anchor ?? null;
              const article = articleRef.current;
              setShareAnchor(anchor);
              setCardContent(
                anchor && article ? buildCardContent(article, anchor) : null,
              );
              bubble.dismiss();
            }}
          />,
          document.body,
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
