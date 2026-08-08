import {
  CheckCircle2,
  Copy,
  Image as ImageIcon,
  Loader2,
  Send,
} from "lucide-react";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { m } from "#/paraglide/messages";
import type { CardContent } from "./quote-card-content";
import { canCopyImage } from "./quote-card-image";
import { QuoteCardPreview } from "./quote-card-preview";
import { useQuoteCardShare } from "./use-quote-card-share";
import { useQuoteQr } from "./use-quote-qr";

export interface QuoteShareContext {
  paperId: string;
  shortId: string;
  title: string;
  isPublic: boolean;
  /** 只有作者能改可见性；非作者根本进不了私有论文的原文视图 */
  canPublish: boolean;
}

export function QuoteShareDialog({
  open,
  onOpenChange,
  url,
  content,
  title,
  share,
  onMakePublic,
  publishing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  content: CardContent | null;
  title: string;
  share: QuoteShareContext;
  onMakePublic: () => void;
  publishing: boolean;
}) {
  // 截图/复制/系统分享这条链路的会话态（含 generationRef 归属判定）都收在这个 hook
  // 里，二维码是另一条独立的、只跟 open/url 相关的异步链路，各自管各自的状态与重置。
  const cardShare = useQuoteCardShare(url, title);
  const { qrDataUrl, failed: qrFailed } = useQuoteQr(open, url);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          // 换一段引文再打开前把上一段的残留状态清掉，让在途的异步收尾判定为
          // 「过期」——具体清什么、为什么清，见 useQuoteCardShare 内部的 reset()。
          cardShare.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-xl border-[var(--line)] bg-[var(--parchment)]">
        <DialogHeader>
          <DialogTitle className="font-serif text-lg text-[var(--ink)]">
            {m.quote_share_dialog_title()}
          </DialogTitle>
        </DialogHeader>

        {!share.isPublic && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-3 py-2">
            <span className="text-xs text-[var(--ink)]">
              {m.quote_share_private_notice()}
            </span>
            {share.canPublish && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={publishing}
                onClick={onMakePublic}
              >
                {publishing && <Loader2 className="h-4 w-4 animate-spin" />}
                {m.quote_share_make_public()}
              </Button>
            )}
          </div>
        )}

        {content ? (
          <QuoteCardPreview
            cardRef={cardShare.cardRef}
            content={content}
            title={title}
            url={url}
            qrDataUrl={qrDataUrl}
          />
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canCopyImage() && (
            <Button
              size="sm"
              className="gap-1.5"
              disabled={cardShare.busy}
              onClick={cardShare.copyImage}
            >
              {cardShare.busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : cardShare.copiedKey === "image" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <ImageIcon className="h-4 w-4" />
              )}
              {cardShare.busy
                ? m.quote_share_generating()
                : cardShare.copiedKey === "image"
                  ? m.quote_share_image_copied()
                  : m.quote_share_copy_image()}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={cardShare.copyLink}
          >
            {cardShare.copiedKey === "link" ? (
              <CheckCircle2 className="h-4 w-4 text-[var(--olive)]" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {cardShare.copiedKey === "link"
              ? m.quote_share_link_copied()
              : m.quote_share_copy_link()}
          </Button>

          {cardShare.canSystemShare && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={cardShare.busy}
              onClick={cardShare.systemShare}
            >
              <Send className="h-4 w-4" />
              {m.quote_share_system_share()}
            </Button>
          )}
        </div>

        {cardShare.failed && (
          <p className="text-xs text-[var(--sienna)]">
            {m.quote_share_render_failed()}
          </p>
        )}
        {qrFailed && (
          <p className="text-xs text-[var(--sienna)]">
            {m.quote_share_qr_failed()}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
