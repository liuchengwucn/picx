import { Quote } from "lucide-react";
import { m } from "#/paraglide/messages";
import type { SelectionBubbleState } from "./use-selection-bubble";

/** 气泡与选区之间的间距 */
const GAP = 10;
/** 选区顶部离视口不足这个高度时，气泡翻到选区下方 */
const FLIP_THRESHOLD = 56;
/**
 * 气泡估算半宽，用来在水平方向把 centerX 钳制在视口内。渲染前拿不到真实宽度（还没
 * 上屏、无法 measure），文案又是四语言变长文本，量不准；反正只是「别让按钮整个飞出
 * 视口」的粗略防线，不追求像素级贴边，保守取一个够用的值即可。
 */
const HALF_WIDTH = 60;
/** 钳制后离视口左右边缘至少留的空隙 */
const EDGE_MARGIN = 8;

export function QuoteShareBubble({
  state,
  onShare,
}: {
  state: SelectionBubbleState;
  onShare: () => void;
}) {
  const above = state.rect.top > FLIP_THRESHOLD;
  const minCenter = HALF_WIDTH + EDGE_MARGIN;
  const maxCenter = window.innerWidth - HALF_WIDTH - EDGE_MARGIN;
  const centerX = Math.min(Math.max(state.rect.centerX, minCenter), maxCenter);
  return (
    <div
      data-quote-bubble
      className="fixed z-50"
      style={{
        left: centerX,
        top: above ? state.rect.top - GAP : state.rect.bottom + GAP,
        transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
      }}
    >
      <button
        type="button"
        onClick={onShare}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border-0 bg-[var(--ink)] px-3 py-2 text-[0.82rem] font-semibold text-[var(--parchment)] shadow-[0_6px_18px_rgba(45,42,36,0.25)] transition-transform duration-150 hover:-translate-y-px"
      >
        <Quote className="h-3.5 w-3.5" />
        {m.quote_share_bubble()}
      </button>
    </div>
  );
}
