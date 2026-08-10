/**
 * 阅读器共享按钮样式(Tailwind 工具类常量)。
 *
 * 这三种按钮在多个阅读器组件中重复出现,集中为常量以避免大段 arbitrary 类重复。
 * 配色全部走 CSS 变量(--ink/--surface/--academic-brown 等),深色模式由变量自动切换,
 * 因此无需 dark: 变体。字体继承自 body 的 --font-sans。用法:cn(TOOL_BTN, "额外类")。
 */

/** 主操作按钮:学术棕渐变实心。 */
export const PRIMARY_BTN =
  "inline-flex items-center gap-2 cursor-pointer border-0 rounded-[12px] px-[1.3rem] py-[0.7rem] " +
  "text-[0.9rem] font-semibold text-white " +
  "bg-[linear-gradient(150deg,var(--academic-brown),var(--academic-brown-deep))] " +
  "shadow-[0_6px_16px_rgba(139,111,71,0.26)] transition-[transform,box-shadow] duration-[180ms] " +
  "hover:-translate-y-[2px] hover:shadow-[0_9px_22px_rgba(139,111,71,0.34)]";

/** 次操作按钮:描边浅底。 */
export const GHOST_BTN =
  "inline-flex items-center gap-2 cursor-pointer rounded-[12px] border border-[var(--line)] " +
  "bg-[var(--surface-strong)] px-[1.2rem] py-[0.7rem] text-[0.9rem] font-semibold text-[var(--ink)] " +
  "transition-[transform,border-color] duration-[180ms] " +
  "hover:-translate-y-[2px] hover:border-[var(--academic-brown)]";

/** 工具条小按钮:更小内距与字号。 */
export const TOOL_BTN =
  "inline-flex items-center gap-[0.4rem] cursor-pointer rounded-[10px] border border-[var(--line)] " +
  "bg-[var(--surface-strong)] px-[0.7rem] py-[0.45rem] text-[0.82rem] font-semibold text-[var(--ink)] " +
  "transition-[border-color,transform,background] duration-[160ms] " +
  "hover:-translate-y-px hover:border-[var(--academic-brown)]";

/** 图标独占的工具条小按钮:把 TOOL_BTN 的横向内距收成正方形。用法:cn(TOOL_BTN, ICON_BTN)。 */
export const ICON_BTN = "px-[0.45rem] py-[0.45rem]";

/**
 * 禁用态:连 hover 位移与描边一起关掉,否则点不动的按钮还在跟着鼠标动。
 * 只对 TOOL_BTN/GHOST_BTN 这类带 hover:-translate-y 的按钮有意义。
 */
export const DISABLED_BTN =
  "disabled:cursor-not-allowed disabled:opacity-40 " +
  "disabled:hover:translate-y-0 disabled:hover:border-[var(--line)]";

/**
 * 居中状态卡片(分析 / 转换进度 / 错误 / 裁剪预览共用)。
 * 用法:cn(STATUS_CARD, "rise-in text-center")。图标色由各处自行追加。
 */
export const STATUS_CARD =
  "w-[min(440px,100%)] rounded-[20px] border border-[var(--line)] " +
  "bg-[linear-gradient(165deg,var(--surface-strong),var(--surface))] px-8 py-10 " +
  "shadow-[0_8px_30px_rgba(45,42,36,0.1)]";

/** 状态卡片顶部圆角图标底座(色彩由调用方追加,如 text-[var(--sienna)]+对应底色)。 */
export const STATUS_ICON =
  "inline-grid h-[60px] w-[60px] place-items-center rounded-[18px]";
