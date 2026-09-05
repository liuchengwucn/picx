import type { ComponentProps, ReactNode } from "react";
import { ModuleKicker } from "#/components/home/module-kicker";
import { Skeleton } from "#/components/ui/skeleton";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

/** 模块色只有这四个 token；收成联合类型，拼错会在调用点就报错而不是渲染出透明方块。 */
export type ModuleColor =
  | "var(--sienna)"
  | "var(--olive)"
  | "var(--academic-brown)"
  | "var(--ink-soft)";

/**
 * 设置页的三个分区共用的骨料：栏眉 + 可选副题 + hairline 行列表。
 * 行的语汇与 /news 的 story-row 同构（serif 粗体标题 / text-xs 灰色 meta /
 * 底部发丝线），刻意不用卡片——三个分区加起来通常不到十行，卡片只会把密度打散。
 *
 * children 落在 <ul> 里，所以**每个子节点都必须是 <li>**：加载骨架用
 * SettingsListSkeleton（它只吐 <li>，不自带 <ul>），空态/失败态用
 * SettingsMessageRow 包一层。直接塞 <div> 会产出非法 HTML，而这里正好是
 * SSR/hydration 边界，非法嵌套在本项目里的表现是 React #418 丢整棵子树。
 */
export function SettingsSection({
  title,
  color,
  subtitle,
  children,
  footer,
}: {
  title: string;
  /** 模块色 token：账户 var(--sienna) / 服务商 var(--olive) / 模板 var(--academic-brown) */
  color: ModuleColor;
  subtitle?: string;
  children: ReactNode;
  /** 列表底部的动作（「添加」按钮） */
  footer?: ReactNode;
}) {
  return (
    <section className="rise-in">
      <ModuleKicker as="h2" color={color}>
        {title}
      </ModuleKicker>
      {subtitle ? (
        <p className="mt-2 text-xs leading-relaxed text-[var(--ink-soft)]">
          {subtitle}
        </p>
      ) : null}
      <ul className="mt-2 list-none p-0">{children}</ul>
      {footer ? <div className="mt-3">{footer}</div> : null}
    </section>
  );
}

export function SettingsRow({
  title,
  badge,
  meta,
  actions,
  leading,
  className,
}: {
  title: ReactNode;
  /** 标题右侧的 chip（「默认」） */
  badge?: ReactNode;
  /** 第二行灰字 */
  meta?: ReactNode;
  /** 行尾动作，文字按钮为主 */
  actions?: ReactNode;
  /** 标题左侧（头像） */
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "flex items-start justify-between gap-4 border-b border-[var(--line)] py-3.5",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {leading}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <RowTitle>{title}</RowTitle>
            {badge}
          </div>
          {meta ? (
            <div className="mt-0.5 text-xs leading-relaxed text-[var(--ink-soft)]">
              {meta}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-none items-center gap-3 pt-0.5 text-xs">
          {actions}
        </div>
      ) : null}
    </li>
  );
}

/**
 * 行标题的排版。SettingsRow 和「整行是一个按钮」的行（退出登录）共用它——否则
 * 这串 serif 字号会有两份，改一处漏一处。
 */
export function RowTitle({ children }: { children: ReactNode }) {
  return (
    <span className="font-serif text-[14.5px] font-bold leading-snug text-[var(--ink)]">
      {children}
    </span>
  );
}

/**
 * 行尾的文字动作。危险动作传 tone="danger"（删除）。
 *
 * 透传 button 的全部原生 props 而不是只收 onClick/disabled，有两个硬需求：
 * shadcn 的 `<AlertDialogTrigger asChild>` 会往子节点注入 ref / onClick /
 * data-state / aria-* ——收窄的 props 会把它们全丢掉，连 ref 都过不了类型；
 * 以及「禁用控件必须可解释」这条项目规范要求调用方能传 aria-describedby。
 */
export function RowAction({
  children,
  tone = "default",
  className,
  ...props
}: ComponentProps<"button"> & { tone?: "default" | "danger" }) {
  return (
    <button
      type="button"
      className={cn(
        "underline-offset-2 hover:underline disabled:opacity-50",
        tone === "danger"
          ? "text-[var(--sienna)]"
          : "text-[var(--ink-soft)] hover:text-[var(--ink)]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * 「默认」chip：与 /news 筛选 chip、/papers 主题 chip 逐字同形（px-2.5 py-0.5
 * text-xs），不用金色 pill——全站这一个 chip 形只能有一种写法。
 */
export function DefaultChip() {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--academic-brown)]/30 bg-[var(--academic-brown)]/8 px-2.5 py-0.5 text-xs text-[var(--academic-brown)]">
      {m.settings_default()}
    </span>
  );
}

/** 列表底部的次级按钮（「添加服务商」「新建模板」）。props 透传理由同 RowAction。 */
export function SectionAddButton({
  children,
  className,
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 text-sm text-[var(--ink)] transition-colors hover:border-[var(--academic-brown)] hover:text-[var(--academic-brown)]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * 整行宽的一条说明（空态、失败面板）。存在的意义只是把内容合法地放进 <ul>：
 * SettingsSection 的 children 必须是 <li>，而空态和失败态天然是 <div>。
 */
export function SettingsMessageRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <li className={cn("border-b border-[var(--line)] py-6", className)}>
      {children}
    </li>
  );
}

const skeletonKeys = ["s1", "s2", "s3"];

/**
 * 贴行几何的骨架：每行一条标题 + 一条 meta。
 *
 * 只吐 <li>、不自带 <ul>——它最常见的用法是塞进 SettingsSection 的 children，
 * 自带 <ul> 会产出 <ul><ul>，既是非法 HTML 也会让读屏播报出一层子列表。
 * 独立使用时（布局骨架）由调用方自己套一个 <ul className="list-none p-0">。
 */
export function SettingsListSkeleton() {
  return (
    <>
      {skeletonKeys.map((key) => (
        <li key={key} className="border-b border-[var(--line)] py-3.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-64" />
        </li>
      ))}
    </>
  );
}
