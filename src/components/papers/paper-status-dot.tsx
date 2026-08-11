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
 * completed 返回 null —— 库里 99% 的行是 completed,给它们各挂一枚绿 badge
 * 等于什么都没说,却占着最大的视觉权重,正是旧卡片「冗余重复」的主因。
 */
export function PaperStatusDot({ status }: { status: PaperRowStatus }) {
  if (status === "failed") {
    return (
      <span
        role="img"
        aria-label={m.papers_status_failed()}
        className="size-1.5 shrink-0 rounded-full bg-[var(--sienna)]"
      />
    );
  }
  const label = inFlightLabel(status);
  if (label) {
    return (
      <span
        role="img"
        aria-label={label()}
        className="size-1.5 shrink-0 rounded-full bg-[var(--gold)]"
      />
    );
  }
  return null;
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
