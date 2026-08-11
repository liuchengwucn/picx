import {
  type InFlightPaperStatus,
  isInFlightPaperStatus,
} from "#/lib/paper-status";
import { m } from "#/paraglide/messages";

export type PaperRowStatus =
  | "pending"
  | "parsing"
  | "processing_text"
  | "processing_image"
  | "completed"
  | "failed";

// 用 Record 而非 Partial<Record>:往 IN_FLIGHT_PAPER_STATUSES 加状态却漏加标签时
// 直接编译报错。pending 也算在途 —— 论文从入库到队列消费者取走都停在 pending,
// 积压时可能很久,不标记的话刚上传的论文看起来跟已完成的一模一样,只是碰巧没 tldr。
const IN_FLIGHT_LABELS: Record<InFlightPaperStatus, () => string> = {
  pending: () => m.papers_status_pending(),
  parsing: () => m.papers_status_parsing(),
  processing_text: () => m.papers_status_processing_text(),
  processing_image: () => m.papers_status_processing_image(),
};

function inFlightLabel(status: PaperRowStatus): (() => string) | null {
  return isInFlightPaperStatus(status) ? IN_FLIGHT_LABELS[status] : null;
}

/**
 * 状态降权后的唯一状态标记。
 * completed 也占同样宽度的透明位:否则标题左边缘在混合列表里忽左忽右,
 * 而这个布局的全部前提就是整列对齐。
 */
export function PaperStatusDot({
  status,
  decorative,
}: {
  status: PaperRowStatus;
  decorative?: boolean;
}) {
  const label =
    status === "failed" ? m.papers_status_failed() : inFlightLabel(status)?.();
  const tone =
    status === "failed"
      ? "bg-[var(--sienna)]"
      : inFlightLabel(status)
        ? "bg-[var(--gold)]"
        : null;

  if (!tone || !label) {
    return <span aria-hidden="true" className="size-1.5 shrink-0" />;
  }

  // decorative:相邻文字已经把状态说了一遍,再给点加 label 会重复朗读
  return decorative ? (
    <span
      aria-hidden="true"
      className={`size-1.5 shrink-0 rounded-full ${tone}`}
    />
  ) : (
    <span
      role="img"
      aria-label={label}
      className={`size-1.5 shrink-0 rounded-full ${tone}`}
    />
  );
}

/**
 * 行内 tldr 位置的兜底文案：
 * 在途 → 当前阶段（斜体）；失败 → 错误原因（赭色）；其余 → 原样返回 tldr。
 * 返回 null 表示这一格留空，不显示任何占位符。
 */
export function resolveRowSecondary(
  status: PaperRowStatus,
  tldr: string,
  errorMessage: string | null,
): { text: string; className: string } | null {
  if (status === "failed") {
    return {
      text: errorMessage || m.papers_status_failed(),
      className: "text-[var(--sienna)]",
    };
  }
  const label = inFlightLabel(status);
  if (label) {
    return { text: label(), className: "italic" };
  }
  if (tldr) return { text: tldr, className: "" };
  return null;
}
