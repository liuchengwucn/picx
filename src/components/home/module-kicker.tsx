import type { ReactNode } from "react";

/**
 * 报刊栏眉:7px 铅字方块(模块色) + 模块名 + 1px 发丝线贯通至容器右缘。
 *
 * 饱和色只出现在那个 7px 方块上,模块名本身走 --ink-soft——这是首页把「分类彩色」
 * 压到 1% 面积以下的唯一手段,别把 color 传给文字。
 */
export function ModuleKicker({
  as: Tag = "div",
  color,
  children,
}: {
  /** 渲染标签。卡片栏眉即该卡的真实小节标题,传 "h2" 让层级落到 DOM 上。 */
  as?: "div" | "h2" | "h3";
  /** 模块色, 用既有 token: var(--sienna)/var(--olive)/var(--academic-brown)/var(--ink-soft) */
  color: string;
  children: ReactNode;
}) {
  return (
    <Tag className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-soft)]">
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
