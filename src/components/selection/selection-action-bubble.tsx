import type { LucideIcon } from "lucide-react";
import { type RefObject, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { SelectionRect } from "#/hooks/use-selection-rect";

/** 气泡与选区之间的间距 */
const GAP = 10;
/** 钳制后离视口左右边缘至少留的空隙 */
const EDGE_MARGIN = 8;

function clampCenter(centerX: number, halfWidth: number): number {
  const min = halfWidth + EDGE_MARGIN;
  const max = window.innerWidth - halfWidth - EDGE_MARGIN;
  // 气泡比视口还宽（窄屏 + 长文案）时上下界会倒挂，Math.min/max 串起来会解出一个
  // 负数 left 把气泡推出左边缘。这种情况只能居中。
  if (max < min) return window.innerWidth / 2;
  return Math.min(Math.max(centerX, min), max);
}

export interface SelectionAction {
  /** React key，同时用于测试定位 */
  key: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

/**
 * 选中文本后浮出的操作气泡。两个阅读视图（markdown 正文与 PDF 文本层）共用同一个
 * 组件、同一套定位纪律，只是各自传不同的 actions。
 *
 * 本组件自己 portal 到 document.body，因为：两个视图的外层 .paper-card 都带无条件的
 * backdrop-filter（见 styles.css），按 CSS 规范会成为 position:fixed 后代的包含块，
 * 不 portal 的话气泡的视口坐标会被解析进卡片自己的盒子里——气泡会挤成右边缘竖条、
 * 滚动后跑到视口外。不是坐标算错了，是包含块错了。这条不变式对两个调用方都成立，
 * 收进组件内部就不存在「调用方忘了包一层」的写法——日后若有人「顺手简化」在调用点
 * 删掉 portal，根本无从下手，因为调用点压根不持有这层包裹。
 *
 * 定位全部在 useLayoutEffect 里做，JSX 上不写任何 left/top：位置取决于自身尺寸
 * （四种语言的文案长度差一倍，"问这段" vs "この部分について聞く"，两段并置又要再翻
 * 一倍），而渲染期量不到尺寸。layout effect 跑在同一次提交的 paint 之前，没有可见的
 * 跳动，也就没必要再维护一份「估算半宽」的平行逻辑。首帧未定位时元素靠 w-max 保证
 * offsetWidth/offsetHeight 是内容固有尺寸，不会因为落在静态位置上被挤窄换行。
 */
export function SelectionActionBubble({
  rect,
  boundaryRef,
  actions,
}: {
  rect: SelectionRect;
  /**
   * 可用空间的界限（取它的视口盒子 ∩ 视口）。PDF 侧传滚动区本身而不是视口：面板在
   * 桌面端是内嵌的（工具栏下沿实测在 y≈247），拿视口顶部当界限的话「翻到下方」这条
   * 分支永远走不到，选中当前可见区第一行时气泡会稳稳盖住工具栏——而工具栏上正是
   * 页码、缩放、搜索、下载这些入口。markdown 正文那边是随文档流的 <article>，不传，
   * 界限退化为纯视口。
   *
   * 传 ref 而不是算好的数字：读它必须做一次同步布局，放在调用方的渲染函数里就是每个
   * rAF 一次强制 layout，还违反「不在 render 期间读 ref」；挪到这里跟自身尺寸一起量，
   * 一次 layout 读完。
   */
  boundaryRef?: RefObject<HTMLElement | null>;
  actions: SelectionAction[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  // 刻意不写依赖数组：视口尺寸、文案、选区任一变化都要重算，而它们并非都体现在某个
  // 可枚举的 prop 上（例如 window 变窄时 centerX 可能一个像素都没动）。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth, offsetHeight } = el;
    const box = boundaryRef?.current?.getBoundingClientRect();
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

  // SSR 兜底：两个调用方本来就只在各自的 state 非 null 时才渲染本组件，也就是
  // 已经在客户端挂载之后才会命中这条路径，这里理应恒为 false；但组件自己持有
  // createPortal 之后，"不依赖调用方守规矩" 就该包括这一条——万一今后有别的调用方
  // 不经意间在服务端渲染路径上引用了它，也不该直接炸在 document.body 上。
  if (typeof document === "undefined") return null;

  return createPortal(
    // data-quote-bubble 不能删：use-selection-rect 的 pointerdown 监听靠它豁免，
    // 否则按钮会在 pointerdown 阶段就被卸载、click 永远不触发。
    <div
      ref={ref}
      data-quote-bubble
      className="fixed z-50 w-max -translate-x-1/2"
    >
      <div className="flex divide-x divide-[var(--parchment)]/20 overflow-hidden rounded-[10px] bg-[var(--ink)] shadow-[0_6px_18px_rgba(45,42,36,0.25)]">
        {actions.map(({ key, icon: Icon, label, onClick }) => (
          <button
            key={key}
            type="button"
            data-action={key}
            onClick={onClick}
            // 窄屏只剩图标，可访问名只能靠 aria-label。文案可见时它与文本同字，
            // 不会读出两遍。
            aria-label={label}
            className="inline-flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[0.82rem] font-semibold text-[var(--parchment)] transition-colors duration-150 hover:bg-[var(--parchment)]/15 active:bg-[var(--parchment)]/25 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--parchment)]"
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {/* 日文两段全文案在 375px 宽的手机上必然溢出，<sm 一律只留图标 */}
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
