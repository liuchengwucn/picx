import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

interface PaperStateCardProps {
  icon?: LucideIcon;
  /** 加载态：图标直接旋转，不套底板 */
  spinning?: boolean;
  title?: string;
  message?: string;
  /** 出错文案用警示色 */
  tone?: "muted" | "danger";
  action?: ReactNode;
  className?: string;
}

/**
 * 论文页的状态卡片（加载 / 空态 / 出错 / 行动召唤）。
 * 详情页与原文视图里这套「卡片 + 居中图标 + 一句话 + 可选按钮」重复了七八处，收敛到这里。
 */
export function PaperStateCard({
  icon: Icon,
  spinning,
  title,
  message,
  tone = "muted",
  action,
  className,
}: PaperStateCardProps) {
  return (
    <div
      className={cn(
        "paper-card flex flex-col items-center justify-center gap-4 p-12 text-center",
        className,
      )}
    >
      {Icon ? (
        spinning ? (
          <Icon className="h-8 w-8 animate-spin text-[var(--academic-brown)]" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--parchment-warm)]">
            <Icon className="h-6 w-6 text-[var(--academic-brown)]" />
          </div>
        )
      ) : null}

      {title || message ? (
        <div className="flex flex-col gap-2">
          {title ? (
            <h2 className="font-serif text-lg font-semibold text-[var(--ink)]">
              {title}
            </h2>
          ) : null}
          {message ? (
            <p
              className={cn(
                "max-w-sm text-sm",
                tone === "danger"
                  ? "text-[var(--sienna)]"
                  : "text-[var(--ink-soft)]",
              )}
            >
              {message}
            </p>
          ) : null}
        </div>
      ) : null}

      {action}
    </div>
  );
}
