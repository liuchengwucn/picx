// 管理页共用的小件与错误分流。站长自用页面，刻意不引入新的 shadcn 组件
// （确认对话框一律走两步按钮），视觉语汇全部复用站点既有的 CSS 变量。
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

/** 四语 JSON 字段的 key 序，与后端 localeRecord 的 z.enum 完全一致（穷尽，缺一即 400） */
export const LOCALE_KEYS = ["en", "zh-cn", "zh-tw", "ja"] as const;
export type LocaleKey = (typeof LOCALE_KEYS)[number];

/** 用各语言自称做标签：这是四个并列的输入框，翻译标签反而认不出哪个是哪个 */
export const LOCALE_LABELS: Record<LocaleKey, string> = {
  en: "English",
  "zh-cn": "简体中文",
  "zh-tw": "繁體中文",
  ja: "日本語",
};

export type LocaleDraft = Record<LocaleKey, string>;

/** 把可能缺语的库内 JSON 补齐成四个受控输入框各有一个 string 的形状 */
export function toLocaleDraft(
  value: Record<string, string> | null | undefined,
): LocaleDraft {
  return {
    en: value?.en ?? "",
    "zh-cn": value?.["zh-cn"] ?? "",
    "zh-tw": value?.["zh-tw"] ?? "",
    ja: value?.ja ?? "",
  };
}

/**
 * tRPC 错误 → 站长看得懂的一句话。
 * CONFLICT / NOT_FOUND / "proposal not pending" 三种都是并发编辑的正常结局，
 * 说成通用「出了点问题」会让站长反复重试一个永远不会成功的操作。
 */
export function adminErrorMessage(error: unknown): string {
  const code =
    error && typeof error === "object" && "data" in error
      ? (error as { data?: { code?: string } }).data?.code
      : undefined;
  const message =
    error && typeof error === "object" && "message" in error
      ? (error as { message?: string }).message
      : undefined;
  if (code === "CONFLICT") return m.admin_slug_taken();
  if (code === "NOT_FOUND") return m.admin_stale_refresh();
  if (code === "BAD_REQUEST" && message === "proposal not pending")
    return m.admin_proposal_not_pending();
  return m.admin_error_generic();
}

/**
 * 分区外壳：serif 标题 + 一条 hairline，标题右侧可挂一个 mono 计数。
 * anchorId 是页首那排跳转链接的锚点，必须是稳定字面量（useId 生成的随机 id
 * 没法写进 href），所以刻意不叫 id —— 那个名字会被 useUniqueElementIds 拦下。
 */
export function AdminSection({
  anchorId,
  title,
  count,
  action,
  children,
}: {
  anchorId: string;
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={anchorId} className="mt-14 scroll-mt-24 first:mt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--line)] pb-2">
        <h2 className="font-serif text-xl font-bold text-[var(--ink)]">
          {title}
          {count === undefined ? null : (
            <span className="ml-2 font-mono text-xs font-normal text-[var(--ink-soft)] tabular-nums">
              {count}
            </span>
          )}
        </h2>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** 空态一行。管理页的空态是「没有待办」，不做插画也不做 CTA */
export function AdminEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-6 text-sm text-[var(--ink-soft)] italic">{children}</p>
  );
}

const PILL_TONES = {
  ok: "border-[var(--olive)] text-[var(--olive)]",
  warn: "border-[var(--amber)] text-[var(--academic-brown-deep)]",
  bad: "border-[var(--sienna)] text-[var(--sienna)]",
  neutral: "border-[var(--line)] text-[var(--ink-soft)]",
} as const;

/** 状态徽标：hairline 描边 + 同色圆点，不用实底色（一屏里能出现十几个） */
export function Pill({
  tone,
  title,
  children,
}: {
  tone: keyof typeof PILL_TONES;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.7rem] leading-4 font-medium whitespace-nowrap",
        PILL_TONES[tone],
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** 表单字段标签。不做 uppercase + 大 tracking：这几个标签有中日文，拉开只会散架 */
export function FieldLabel({
  htmlFor,
  children,
  hint,
}: {
  htmlFor: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-xs font-semibold text-[var(--ink-soft)]"
    >
      {children}
      {hint ? (
        <span className="ml-2 font-normal text-[var(--ink-soft)]/80">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/** 表单里的行内校验/说明文字 */
export function FormNote({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "error";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "text-xs",
        tone === "error"
          ? "font-medium text-[var(--sienna)]"
          : "text-[var(--ink-soft)]",
      )}
    >
      {children}
    </p>
  );
}

/** 两步确认自动解除武装的时长。够站长看清第二段文案，又不会一直挂在页面上 */
const CONFIRM_ARM_MS = 6000;

/**
 * 两步确认按钮：第一次点击换成 confirmLabel（进入待确认态），第二次才真执行。
 * 失焦或 6 秒无动作自动解除，免得一个「确认删除？」长期停在页面上被误点。
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  variant = "outline",
  className,
  "data-testid": testId,
}: {
  label: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: "outline" | "destructive" | "default";
  className?: string;
  "data-testid"?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), CONFIRM_ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  // pending 期间解除武装：一次点击已经发出请求，按钮还留在待确认态会诱导第二次提交
  useEffect(() => {
    if (disabled) setArmed(false);
  }, [disabled]);

  return (
    <Button
      type="button"
      size="sm"
      variant={armed ? "destructive" : variant}
      disabled={disabled}
      data-testid={testId}
      data-armed={armed ? "true" : "false"}
      className={className}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
          return;
        }
        setArmed(true);
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}
