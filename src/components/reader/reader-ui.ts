/**
 * 阅读界面共享样式常量。
 *
 * 不从属于任何单个页面:markdown 阅读器(reader-settings / reader-toc-drawer)与
 * 论文 PDF 阅读器(pdf-toolbar / pdf-find-bar / pdf-outline-drawer)以及
 * paper-reader-view 共用同一套按钮外观,改这里等于同时改所有阅读工具栏。
 *
 * 配色全部走 CSS 变量(--ink/--surface/--academic-brown 等),深色模式由变量自动切换,
 * 因此无需 dark: 变体。字体继承自 body 的 --font-sans。用法:cn(TOOL_BTN, "额外类")。
 */

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
 * 只对 TOOL_BTN 这类带 hover:-translate-y 的按钮有意义。
 */
export const DISABLED_BTN =
  "disabled:cursor-not-allowed disabled:opacity-40 " +
  "disabled:hover:translate-y-0 disabled:hover:border-[var(--line)]";
