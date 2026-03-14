import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Globe, Loader2, Share2 } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";

interface ShareBannerProps {
  paperId: string;
  shortId: string;
  isPublic: boolean;
  canShare: boolean;
}

export function ShareBanner({
  paperId,
  shortId,
  isPublic,
  canShare,
}: ShareBannerProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const invalidatePaperQueries = () => {
    queryClient.invalidateQueries({
      queryKey: trpc.paper.list.queryKey(),
    });
    queryClient.invalidateQueries({
      queryKey: trpc.paper.getById.queryKey(paperId),
    });
  };

  const togglePublicMutation = useMutation(
    trpc.paper.togglePublic.mutationOptions({
      onSuccess: invalidatePaperQueries,
    }),
  );

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/p/${shortId}`
      : "";

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
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
      <div className="rise-in mt-3 mb-6">
        <div className="overflow-hidden rounded-2xl border border-[var(--olive)]/30 bg-gradient-to-br from-[var(--olive)]/5 via-[var(--parchment-warm)] to-[var(--olive)]/5 shadow-[0_2px_12px_rgba(107,142,35,0.06)]">
          <div className="relative p-6">
            <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(107,142,35,0.15),transparent_70%)] blur-2xl" />
            <div className="pointer-events-none absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(139,111,71,0.1),transparent_70%)] blur-2xl" />

            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--olive)] shadow-[0_4px_12px_rgba(107,142,35,0.24)]">
                  <CheckCircle2 className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="mb-1 font-serif text-lg font-semibold text-[var(--ink)]">
                    {m.paper_shared_notice()}
                  </h3>
                  <p className="text-sm text-[var(--ink-soft)]">
                    {m.paper_share_description()}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--parchment)] px-3 py-2">
                  <Globe className="h-4 w-4 text-[var(--olive)]" />
                  <span className="max-w-[200px] truncate text-xs font-mono text-[var(--ink-soft)]">
                    {shareUrl}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyLink}
                    className="gap-1.5"
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
                    variant="outline"
                    size="sm"
                    onClick={handleTogglePublic}
                    disabled={togglePublicMutation.isPending}
                    className="text-[var(--sienna)]"
                  >
                    {togglePublicMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      m.paper_unshare()
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rise-in mt-3 mb-6 overflow-hidden rounded-2xl border border-[var(--academic-brown)]/18 bg-gradient-to-br from-[var(--academic-brown)]/5 via-[var(--parchment-warm)] to-[var(--gold)]/5 shadow-[0_2px_12px_rgba(139,111,71,0.06)]">
      <div className="relative p-6">
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(139,111,71,0.15),transparent_70%)] blur-2xl" />
        <div className="pointer-events-none absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(201,169,97,0.1),transparent_70%)] blur-2xl" />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--academic-brown),var(--gold))] shadow-[0_4px_12px_rgba(139,111,71,0.24)]">
              <Share2 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="mb-1 font-serif text-lg font-semibold text-[var(--ink)]">
                {m.paper_share_title()}
              </h3>
              <p className="text-sm text-[var(--ink-soft)]">
                {m.paper_share_description()}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              onClick={handleTogglePublic}
              disabled={!canShare || togglePublicMutation.isPending}
              className="gap-2 bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white shadow-[0_4px_12px_rgba(139,111,71,0.24)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(139,111,71,0.32)]"
            >
              {togglePublicMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {m.paper_share_button()}
                </>
              ) : (
                <>
                  <Globe className="h-4 w-4" />
                  {m.paper_share_button()}
                </>
              )}
            </Button>
            {!canShare && (
              <p className="text-xs text-[var(--sienna)] text-center">
                {m.paper_share_requirement()}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
