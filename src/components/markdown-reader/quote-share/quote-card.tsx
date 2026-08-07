import type { CSSProperties, Ref } from "react";
import { useEffect, useRef } from "react";
import { m } from "#/paraglide/messages";
import type { CardContent } from "./quote-card-content";

/** 卡片固定宽度（CSS px）。截图按 pixelRatio 2 输出（Task 5）。 */
export const CARD_WIDTH = 720;

/**
 * 引用卡片。既是弹窗里的预览，也是截图的素材——同一棵 DOM，所见即所得。
 *
 * 卡片固定亮色：外层显式钉住用到的 CSS 变量并声明 color-scheme: light，暗色模式下也出
 * parchment 亮卡，分享出去的图在别人那里更通用，也避免暗色截图贴进浅色聊天窗里刺眼。
 */
export function QuoteCard({
  cardRef,
  content,
  title,
  url,
  qrDataUrl,
}: {
  cardRef: Ref<HTMLDivElement>;
  content: CardContent;
  title: string;
  url: string;
  qrDataUrl: string | null;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // content.blocks 是原生 DOM 克隆（保留了 KaTeX 渲染产物），只能手动挂载
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    body.replaceChildren(...content.blocks);
  }, [content]);

  return (
    <div
      ref={cardRef}
      style={
        {
          width: CARD_WIDTH,
          colorScheme: "light",
          "--parchment": "#faf8f3",
          "--parchment-warm": "#f4f1e8",
          "--ink": "#2d2a24",
          "--ink-soft": "#6b6560",
          "--academic-brown": "#8b6f47",
          "--gold": "#c9a961",
          "--line": "rgba(139, 111, 71, 0.15)",
        } as CSSProperties
      }
      className="overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--parchment)]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] bg-[linear-gradient(90deg,rgba(139,111,71,0.10),rgba(201,169,97,0.06))] px-5 py-3">
        <div className="min-w-0">
          <div className="line-clamp-2 text-[15px] font-bold leading-snug text-[var(--ink)]">
            {title}
          </div>
          {content.section && (
            <div className="mt-1 text-[11px] text-[var(--academic-brown)]">
              § {content.section}
            </div>
          )}
        </div>
        <div className="shrink-0 text-[11px] tracking-[0.08em] text-[var(--ink-soft)]">
          picx
        </div>
      </div>

      <div className="px-5 py-4">
        <div
          ref={bodyRef}
          className="reader-prose"
          data-reader-font="serif"
          style={
            {
              "--reader-font-size": "16px",
              "--reader-measure": "100%",
              "--reader-leading": "1.85",
            } as CSSProperties
          }
        />
        {content.truncated && (
          <div className="mt-2 text-[11px] italic text-[var(--ink-soft)]">
            {m.quote_share_truncated()}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-[var(--line)] bg-[var(--parchment-warm)] px-5 py-3">
        <div className="min-w-0">
          <div className="truncate text-[11px] text-[var(--academic-brown)]">
            {url.replace(/^https?:\/\//, "")}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--ink-soft)]">
            {m.quote_share_qr_hint()}
          </div>
        </div>
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt=""
            className="h-[44px] w-[44px] shrink-0 rounded"
          />
        )}
      </div>
    </div>
  );
}
