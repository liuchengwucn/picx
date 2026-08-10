import { MessageSquareQuote } from "lucide-react";
import { type RefObject, useLayoutEffect, useRef } from "react";
import type { SelectionRect } from "#/hooks/use-selection-rect";
import { m } from "#/paraglide/messages";

/** 气泡与选区之间的间距 */
const GAP = 10;
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
 *
 * 定位全部在 useLayoutEffect 里做，JSX 上不写任何 left/top：位置取决于自身尺寸
 * （四种语言的文案长度差一倍，"问这段" vs "この部分について聞く"），而渲染期量不到
 * 尺寸。layout effect 跑在同一次提交的 paint 之前，没有可见的跳动，也就没必要再维护
 * 一份「估算值」的平行逻辑。首帧未定位时元素靠 w-max 保证 offsetWidth/offsetHeight
 * 是内容固有尺寸，不会因为落在静态位置上被挤窄换行、量出错误的高度。
 */
export function PdfSelectionBubble({
  rect,
  boundaryRef,
  onAsk,
}: {
  rect: SelectionRect;
  /**
   * 可用空间的界限（取它的视口盒子 ∩ 视口）。传 PDF 滚动区本身，而不是视口：
   * 面板在桌面端是内嵌的（工具栏下沿实测在 y≈247），拿视口顶部当界限的话「翻到下方」
   * 这条分支永远走不到，选中当前可见区第一行时气泡会稳稳盖住工具栏——而工具栏上正是
   * 页码、缩放、搜索、下载这些入口。
   *
   * 传 ref 而不是算好的数字：读它必须做一次同步布局，放在调用方的渲染函数里就是
   * 每个 rAF 一次强制 layout，还违反「不在 render 期间读 ref」；挪到这里跟自身尺寸
   * 一起量，一次 layout 读完。
   */
  boundaryRef: RefObject<HTMLElement | null>;
  onAsk: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // 刻意不写依赖数组：视口尺寸、文案、选区任一变化都要重算，而它们并非都体现在某个
  // 可枚举的 prop 上（例如 window 变窄时 centerX 可能一个像素都没动）。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth, offsetHeight } = el;
    const box = boundaryRef.current?.getBoundingClientRect();
    const limitTop = Math.max(0, box?.top ?? 0);
    const limitBottom = Math.min(
      window.innerHeight,
      box?.bottom ?? window.innerHeight,
    );

    // 上方放不下就翻到下方；两边都放不下时（选区把整条可见带占满了，跨页选区回滚到
    // 页首就是这种情况）下面的钳制会把它按回带子里，宁可压住一点选区，也不能整个
    // 掉到视口外——那等于用户划完选什么都没看见。
    const above = rect.top - GAP - offsetHeight >= limitTop;
    const wanted = above ? rect.top - GAP - offsetHeight : rect.bottom + GAP;
    const top = Math.min(
      Math.max(wanted, limitTop),
      limitBottom - offsetHeight,
    );

    el.style.left = `${clampCenter(rect.centerX, offsetWidth / 2)}px`;
    // 竖直方向直接给上沿坐标、不再用 translateY，钳制才好写
    el.style.top = `${Math.max(top, 0)}px`;
  });

  return (
    <div
      ref={ref}
      data-quote-bubble
      className="fixed z-50 w-max -translate-x-1/2"
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
