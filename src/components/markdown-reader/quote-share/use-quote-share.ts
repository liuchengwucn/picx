import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";
import type { CardContent } from "./quote-card-content";

/** 一次分享要展示的全部内容：深链 + 卡片正文。由各视图在点击当时算好交上来。 */
export interface QuoteSharePayload {
  url: string;
  content: CardContent | null;
}

/**
 * 分享弹窗的会话态与「一键公开」mutation。
 *
 * 提到页面级（而不是留在 reader 的 overlay 里）是为了让 PDF 视图也能复用整套弹窗：
 * 卡片正文必须在点击当时从各自的活 DOM / 纯文本算出来，所以**生产在各视图侧、消费在
 * 页面级**。PDF 侧因此完全不必认识 tRPC。
 *
 * shortId 必须是路由参数那一个：它要 invalidate 的查询也是用路由参数做 key 的，
 * 两边来源一分岔，invalidate 就静默失配、公开后私有提示条永远不消失。
 */
export function useQuoteShare(paperId: string, shortId: string) {
  const [payload, setPayload] = useState<QuoteSharePayload | null>(null);
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const togglePublic = useMutation(
    trpc.paper.togglePublic.mutationOptions({
      onSuccess: () => {
        // 详情页的 paper 查询要重取，弹窗里的私有提示条才会消失
        void queryClient.invalidateQueries({
          queryKey: trpc.paper.getByShortId.queryKey(shortId),
        });
      },
      // 这是流程中途的模态决策点，不是设置页的后台动作：静默失败会让用户带着一条
      // 他们以为已经解除、实则仍是死链的分享出门，必须显式提示。
      onError: () => toast.error(m.quote_share_make_public_failed()),
    }),
  );

  const openShare = useCallback((next: QuoteSharePayload) => {
    setPayload(next);
  }, []);

  const closeShare = useCallback(() => {
    setPayload(null);
  }, []);

  return {
    /** 非空即「弹窗该开着」；url 与 content 都从这里取 */
    payload,
    openShare,
    closeShare,
    publishing: togglePublic.isPending,
    makePublic: () => togglePublic.mutate({ paperId }),
  };
}
