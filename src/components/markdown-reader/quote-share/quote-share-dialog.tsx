import {
  CheckCircle2,
  Copy,
  Image as ImageIcon,
  Loader2,
  Send,
} from "lucide-react";
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
import {
  canCopyImage,
  copyCardAndLink,
  renderQuoteCard,
  renderQuoteQr,
} from "./quote-card-image";

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
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardHeight, setCardHeight] = useState(0);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canSystemShare, setCanSystemShare] = useState(false);
  // 截图链路要跨越几百毫秒到数秒。弹窗关掉再为另一段引文打开时，上一次的异步收尾
  // （setBusy / flash / 错误日志）不能落到新会话上——用自增序号判定归属。
  const generationRef = useRef(0);

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

  // 探测系统分享能力放 effect 里而不是渲染期读 navigator：SSR 时 navigator 不存在，
  // 渲染期读会导致 hydration 不一致（服务端渲染出 false，客户端可能是 true）。
  useEffect(() => {
    setCanSystemShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  // 弹窗打开时才生成二维码：url 在弹窗关闭时可能还没定下来，也不必每次 content 变化
  // 都重算——深链只跟 url 有关。
  useEffect(() => {
    if (!open || !url) {
      return;
    }
    let cancelled = false;
    renderQuoteQr(url)
      .then((data) => {
        if (!cancelled) {
          setQrDataUrl(data);
        }
      })
      .catch((err) => console.error("Failed to render quote QR:", err));
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  const flash = (key: string) => {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      flash("link");
    } catch (err) {
      console.error("Failed to copy quote link:", err);
    }
  };

  const copyImage = async () => {
    const node = cardRef.current;
    if (!node) {
      return;
    }
    const gen = ++generationRef.current;
    setBusy(true);
    try {
      const blob = await renderQuoteCard(node);
      await copyCardAndLink(blob, url);
      if (generationRef.current !== gen) {
        return;
      }
      flash("image");
    } catch (err) {
      if (generationRef.current !== gen) {
        return;
      }
      console.error("Failed to copy quote card:", err);
    } finally {
      if (generationRef.current === gen) {
        setBusy(false);
      }
    }
  };

  const systemShare = async () => {
    const node = cardRef.current;
    if (!node) {
      return;
    }
    const gen = ++generationRef.current;
    setBusy(true);
    let file: File | null = null;
    try {
      const blob = await renderQuoteCard(node);
      file = new File([blob], "picx-quote.png", { type: "image/png" });
    } catch (err) {
      console.error("Failed to render quote card for share:", err);
    }
    if (generationRef.current !== gen) {
      return;
    }
    // 面板是系统模态，用户在上面停留多久都不该让按钮一直转圈——截图一出结果就收尾。
    setBusy(false);

    if (file) {
      try {
        await navigator.share({ title, url, files: [file] });
        return;
      } catch (err) {
        // 用户主动关掉分享面板，不要再弹第二次
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        console.warn(
          "Share with image failed; falling back to link only:",
          err,
        );
      }
    }
    try {
      await navigator.share({ title, url });
    } catch {
      // 用户取消，什么都不做
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          // 换一段引文再打开前把上一段的残留状态清掉：不然会先闪一下旧二维码，
          // 占位盒也会先按旧卡片的高度渲染一帧。同时让在途的异步收尾（见
          // generationRef）都判定为「过期」，不再落到下一次会话上。
          setCopiedKey(null);
          setQrDataUrl(null);
          setCardHeight(0);
          setBusy(false);
          generationRef.current += 1;
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
                  qrDataUrl={qrDataUrl}
                />
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canCopyImage() && (
            <Button
              size="sm"
              className="gap-1.5"
              disabled={busy}
              onClick={copyImage}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : copiedKey === "image" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <ImageIcon className="h-4 w-4" />
              )}
              {busy
                ? m.quote_share_generating()
                : copiedKey === "image"
                  ? m.quote_share_image_copied()
                  : m.quote_share_copy_image()}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={copyLink}
          >
            {copiedKey === "link" ? (
              <CheckCircle2 className="h-4 w-4 text-[var(--olive)]" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copiedKey === "link"
              ? m.quote_share_link_copied()
              : m.quote_share_copy_link()}
          </Button>

          {canSystemShare && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={busy}
              onClick={systemShare}
            >
              <Send className="h-4 w-4" />
              {m.quote_share_system_share()}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
