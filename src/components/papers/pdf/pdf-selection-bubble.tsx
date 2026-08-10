import { MessageSquareQuote } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type { SelectionRect } from "#/hooks/use-selection-rect";
import { m } from "#/paraglide/messages";

/** 气泡与选区之间的间距 */
const GAP = 10;
/**
 * 首帧的估算尺寸。真实尺寸由下面的 useLayoutEffect 量出来覆盖，这两个值只决定
 * 「量之前那一瞬间」的位置——layout effect 跑在同一次提交的 paint 之前，用户看不到。
 */
const EST_HALF_WIDTH = 72;
const EST_HEIGHT = 36;
/** 钳制后离视口左右边缘至少留的空隙 */
const EDGE_MARGIN = 8;

function clampCenter(centerX: number, halfWidth: number): number {
  const min = halfWidth + EDGE_MARGIN;
  const max = window.innerWidth - halfWidth - EDGE_MARGIN;
  // 气泡比视口还宽（窄屏 + 长文案，日文那条尤其容易）时上下界会倒挂，
  // Math.min/max 串起来会解出一个负数 left 把气泡推出左边缘。这种情况只能居中。
  if (max < min) return window.innerWidth / 2;
  return Math.min(Math.max(centerX, min), max);
}

/**
 * PDF 文本层上的「问这段」气泡。
 *
 * 必须由调用方 portal 到 document.body：PDF 面板的 .paper-card 带 backdrop-filter，
 * 会成为 position:fixed 后代的包含块，不 portal 的话气泡会被钉在面板内部坐标系里。
 */
export function PdfSelectionBubble({
  rect,
  boundaryTop,
  onAsk,
}: {
  rect: SelectionRect;
  /**
   * 「上方」的可用空间从哪里算起（视口坐标）。传 PDF 滚动区的上沿，而不是视口顶部：
   * 面板在桌面端是内嵌的（工具栏下沿实测在 y≈247），拿视口顶部当界限的话「翻到下方」
   * 这条分支永远走不到，选中当前可见区第一行时气泡会稳稳盖住工具栏——而工具栏上正是
   * 页码、缩放、搜索、下载这些入口。
   */
  boundaryTop: number;
  onAsk: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // 定位必须用真实尺寸：四种语言的文案长度差一倍（"问这段" vs "この部分について聞く"），
  // 任何写死的估算宽度都会在某个语种 + 窄屏组合下让按钮半个身子挂在视口外；高度同理
  // 决定了上方到底放不放得下。渲染期拿不到尺寸，所以先按估算值出一帧，再在 layout
  // 阶段量完直接改 style——layout effect 跑在 paint 之前，不会有可见的跳动。
  // 刻意不写依赖数组：视口宽度、文案、选区任一变化都要重算，而它们并非都体现在某个
  // 可枚举的 prop 上（例如 window 变窄时 centerX 可能一个像素都没动）。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth, offsetHeight } = el;
    const above = rect.top - GAP - offsetHeight >= Math.max(boundaryTop, 0);
    el.style.left = `${clampCenter(rect.centerX, offsetWidth / 2)}px`;
    el.style.top = `${above ? rect.top - GAP : rect.bottom + GAP}px`;
    el.style.transform = above
      ? "translate(-50%, -100%)"
      : "translate(-50%, 0)";
  });

  const estAbove =
    rect.top - GAP - EST_HEIGHT >= Math.max(boundaryTop, 0) ? 1 : 0;

  return (
    <div
      ref={ref}
      data-quote-bubble
      className="fixed z-50"
      style={{
        left: clampCenter(rect.centerX, EST_HALF_WIDTH),
        top: estAbove ? rect.top - GAP : rect.bottom + GAP,
        transform: estAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)",
      }}
    >
      <button
        type="button"
        onClick={onAsk}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border-0 bg-[var(--ink)] px-3 py-2 text-[0.82rem] font-semibold text-[var(--parchment)] shadow-[0_6px_18px_rgba(45,42,36,0.25)] transition-transform duration-150 hover:-translate-y-px"
      >
        <MessageSquareQuote className="h-3.5 w-3.5" />
        {m.pdf_ask_selection()}
      </button>
    </div>
  );
}
