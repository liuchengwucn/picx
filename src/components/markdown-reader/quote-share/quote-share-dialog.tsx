import { CheckCircle2, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { m } from "#/paraglide/messages";
import { CARD_WIDTH, QuoteCard } from "./quote-card";
import type { CardContent } from "./quote-card-content";

/** 弹窗里预览卡片的缩放比例：720px 宽的卡片塞进弹窗宽度 */
const PREVIEW_SCALE = 0.62;

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
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardHeight, setCardHeight] = useState(0);

  // transform 不改变布局盒：外层的滚动区会按未缩放的 720px 卡片算，多出约 40% 的空白
  // 可滚区域，横向也会冒出滚动条。用实测的未缩放高度（offsetHeight，不受 transform
  // 影响；getBoundingClientRect 会被祖先的 scale 影响，不能用）撑一个视觉尺寸的占位盒。
  // content 从 null 变为非 null 时 cardRef 挂到一个全新的 DOM 节点（条件渲染重新挂载），
  // effect 体里虽不直接读 content，但它是 cardRef.current 身份变化的唯一信号源。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 见上——必须靠 content 这个依赖重新 observe 新节点
  useEffect(() => {
    const node = cardRef.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver(() => setCardHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [content]);

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
          <div className="max-h-[52vh] overflow-auto rounded-lg bg-[var(--parchment-warm)] p-4">
            <div
              style={{
                width: CARD_WIDTH * PREVIEW_SCALE,
                height: cardHeight * PREVIEW_SCALE,
              }}
            >
              <div
                className="origin-top-left"
                style={{ transform: `scale(${PREVIEW_SCALE})` }}
              >
                <QuoteCard
                  cardRef={cardRef}
                  content={content}
                  title={title}
                  url={url}
                  qrDataUrl={null}
                />
              </div>
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
