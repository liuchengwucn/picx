import { CheckCircle2, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { m } from "#/paraglide/messages";
import { QuoteCard } from "./quote-card";
import type { CardContent } from "./quote-card-content";

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  content: CardContent | null;
  title: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy quote link:", err);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setCopied(false);
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

        {content ? (
          <div className="max-h-[52vh] overflow-y-auto rounded-lg bg-[var(--parchment-warm)] p-4">
            <div className="origin-top scale-[0.62]">
              <QuoteCard
                cardRef={null}
                content={content}
                title={title}
                url={url}
                qrDataUrl={null}
              />
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={copy}
          >
            {copied ? (
              <CheckCircle2 className="h-4 w-4 text-[var(--olive)]" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? m.quote_share_link_copied() : m.quote_share_copy_link()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
