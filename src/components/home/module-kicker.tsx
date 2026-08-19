import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/**
 * 报刊栏眉:7px 铅字方块(模块色) + 模块名 + 1px 发丝线贯通至容器右缘。
 *
 * 饱和色只出现在那个 7px 方块上,模块名本身走 --ink-soft——这是首页把「分类彩色」
 * 压到 1% 面积以下的唯一手段,别把 color 传给文字。
 */
export function ModuleKicker({
  as: Tag = "div",
  color,
  id,
  className,
  children,
}: {
  /** 渲染标签。卡片栏眉即该卡的真实小节标题,传 "h2" 让层级落到 DOM 上。 */
  as?: "div" | "h2" | "h3";
  /** 模块色, 用既有 token: var(--sienna)/var(--olive)/var(--academic-brown)/var(--ink-soft) */
  color: string;
  /**
   * 页内锚点 id。栏眉是整个模块里唯一「细高度」的元素,滚动跟随把 id 挂在它身上
   * 而不是外层 section —— 两个高元素会同时落进判定带,细元素不会(见 use-scroll-spy)。
   */
  id?: string;
  /** 只用来配 scroll-margin-top 之类的锚点偏移,别拿来改栏眉自身的排版 */
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      id={id}
      className={cn(
        "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-soft)]",
        className,
      )}
    >
      <span
        aria-hidden
        className="h-[7px] w-[7px] flex-none"
        style={{ background: color }}
      />
      <span>{children}</span>
      <span aria-hidden className="h-px flex-1 bg-[var(--line)]" />
    </Tag>
  );
}
