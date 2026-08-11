// 管理页共用的小件与错误分流。站长自用页面，刻意不引入新的 shadcn 组件
// （确认对话框一律走两步按钮），视觉语汇全部复用站点既有的 CSS 变量。
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "#/components/ui/button";
import { useTRPC } from "#/integrations/trpc/react";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

/**
 * 任一处写入后，把整棵 admin 子树失效。
 *
 * 不做精细失效是有意的：slug / name 同时嵌在 listDirections、listProposals
 * （directionSlug / directionName）和 listRecentDigests（directionSlug）三份投影里，
 * 只失效 listDirections 的话，改完 slug 后提案卡仍拿旧 slug 去拼
 * /gallery/d/$slug/$issue —— 一个 404 链接。这一页四条查询都廉价、又只有站长一个人
 * 在用，一把梭比逐处列举漏一个要安全得多。
 */
export function useInvalidateAdmin() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries(trpc.admin.pathFilter());
  }, [queryClient, trpc]);
}

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
 * CONFLICT / NOT_FOUND / "proposal not pending" / "direction not active" 四种都是
 * 并发编辑的正常结局，说成通用「出了点问题」会让站长反复重试一个永远不会成功的操作。
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
  // 触发按钮在方向停用时已经灰掉，这条兜的是「另一个标签页刚把它停用」的时间差
  if (code === "BAD_REQUEST" && message === "direction not active")
    return m.admin_trigger_inactive();
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

/**
 * 表单里的行内校验/说明文字。
 * 错误分支挂 role="alert"：这些表单很长，出错的字段（slug）在最上面而错误文字在
 * 最下面，不播报的话读屏用户只会看到提交没反应。
 */
export function FormNote({
  tone = "muted",
  id,
  children,
}: {
  tone?: "muted" | "error";
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      id={id}
      role={tone === "error" ? "alert" : undefined}
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
  description,
  "data-testid": testId,
}: {
  label: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: "outline" | "destructive" | "default";
  className?: string;
  /**
   * 同一页出现多个同名按钮时（比如每行源都有一个「删除」）用来区分所在的行。
   *
   * 刻意做成 aria-describedby 指向按钮**外部**的一个 sr-only span，而不是 aria-label：
   * 一旦可访问名由 aria-label 给出，按钮的后代就成了 presentational children 被从
   * 可访问性树里剪掉——下面那个 aria-live 从此永不播报，而按钮名又始终停在
   * 「删除 — arxiv_query …」，两个无障碍修法互相抵消。描述不触发这条剪枝。
   */
  description?: string;
  "data-testid"?: string;
}) {
  const descriptionId = useId();
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
    <>
      {/* sr-only 是 absolute 定位，落在 flex 容器里不占位 */}
      {description ? (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant={armed ? "destructive" : variant}
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
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
        {/* 可访问名从「删除」变成「确认删除？」是一次状态变化，不播报的话读屏用户
            按下第一次后什么也不知道，第二次按下就直接删了 */}
        <span aria-live="polite" className="inline-flex items-center gap-2">
          {armed ? confirmLabel : label}
        </span>
      </Button>
    </>
  );
}
