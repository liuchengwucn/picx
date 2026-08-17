import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Globe, Loader2, Lock } from "lucide-react";
import { useState } from "react";
import { PublicBadge } from "#/components/papers/public-badge";
import { Button } from "#/components/ui/button";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";

interface ShareControlsProps {
  paperId: string;
  shortId: string;
  isPublic: boolean;
  canShare: boolean;
}

/**
 * 页头工具条右端的公开开关。只管「公开 / 取消公开」这一个状态：
 * 链接、嵌入代码、社交分享都在 ShareDialog 里，不在这里重复。
 */
export function ShareControls({
  paperId,
  shortId,
  isPublic,
  canShare,
}: ShareControlsProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const invalidatePaperQueries = () => {
    // paper.list 页用 infiniteQueryOptions，key 带 type:"infinite"；
    // queryKey() 产出的 type:"query" 不是它的前缀，必须用 pathKey()。
    queryClient.invalidateQueries({
      queryKey: trpc.paper.list.pathKey(),
    });
    queryClient.invalidateQueries({
      queryKey: trpc.paper.getById.queryKey(paperId),
    });
    queryClient.invalidateQueries({
      queryKey: trpc.paper.getByShortId.queryKey(shortId),
    });
  };

  const togglePublicMutation = useMutation(
    trpc.paper.togglePublic.mutationOptions({
      onSuccess: invalidatePaperQueries,
    }),
  );

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/p/${shortId}`,
      );
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleTogglePublic = () => {
    togglePublicMutation.mutate({ paperId });
  };

  if (isPublic) {
    return (
      <div className="flex items-center gap-1.5">
        <PublicBadge />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopyLink}
          className="gap-1.5 text-[var(--ink-soft)] hover:text-[var(--ink)]"
        >
          {linkCopied ? (
            <>
              <CheckCircle2 className="h-4 w-4" />
              {m.paper_link_copied()}
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              {m.paper_copy_link()}
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleTogglePublic}
          disabled={togglePublicMutation.isPending}
          className="text-[var(--sienna)] hover:text-[var(--sienna)]"
        >
          {togglePublicMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            m.paper_unshare()
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* 按钮置灰时它自己解释不了原因，补一句可见的说明 */}
      <span className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)]">
        <Lock className="h-3.5 w-3.5" />
        {canShare ? m.paper_private_notice() : m.paper_share_requirement()}
      </span>
      <Button
        size="sm"
        onClick={handleTogglePublic}
        disabled={!canShare || togglePublicMutation.isPending}
        className="gap-1.5 bg-[var(--academic-brown)] text-white hover:bg-[var(--academic-brown-deep)]"
      >
        {togglePublicMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Globe className="h-4 w-4" />
        )}
        {m.paper_share_button()}
      </Button>
    </div>
  );
}
