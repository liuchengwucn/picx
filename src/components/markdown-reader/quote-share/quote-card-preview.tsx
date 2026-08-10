import type { RefObject } from "react";
import { useEffect, useState } from "react";
import { CARD_WIDTH, QuoteCard } from "./quote-card";
import type { CardContent } from "./quote-card-content";

/** 弹窗里预览卡片的缩放比例：720px 宽的卡片塞进弹窗宽度 */
const PREVIEW_SCALE = 0.62;

/**
 * 弹窗里的卡片预览：占位盒撑出未缩放卡片按 PREVIEW_SCALE 换算后的视觉尺寸，内层用
 * transform: scale 实际缩小卡片渲染。这个组件只在有 content 时才被父组件挂载，
 * 卸载时 cardHeight 自然归零，不需要外部显式重置。
 */
export function QuoteCardPreview({
  cardRef,
  content,
  title,
  url,
  qrDataUrl,
}: {
  cardRef: RefObject<HTMLDivElement | null>;
  content: CardContent;
  title: string;
  url: string;
  qrDataUrl: string | null;
}) {
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

  return (
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
  );
}
