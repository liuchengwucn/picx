import {
  type InFlightPaperStatus,
  isInFlightPaperStatus,
} from "#/lib/paper-status";
import { cn } from "#/lib/utils";
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
 * 状态降权后的唯一状态标记 —— 纯装饰,不带 a11y label。
 * 状态文字本身已经在相邻的 secondary/mobileNote 里说过一遍(resolveRowSecondary),
 * 这里再挂 aria-label 只会造成重复朗读,所以点永远 aria-hidden。
 *
 * completed 也占同样宽度的透明位:否则标题左边缘在混合列表里忽左忽右,而这个
 * 布局的全部前提就是整列对齐。库里 99% 的行是 completed,给它们各挂一枚绿
 * badge 等于什么都没说,却占着最大的视觉权重,正是旧卡片「冗余重复」的主因。
 *
 * block:非替换的 inline 元素不吃 width/height。桌面上这个 span 是
 * `sm:flex` Link 的直接子元素,flex 会把它块级化所以看似没问题;移动端它被
 * 包在一个纯 block 的定位 wrapper 里,不加 block 的话尺寸整个不生效、永远
 * 画不出来。加 block 在桌面是 no-op,在移动端是必须的,所以两个分支都要加。
 */
export function PaperStatusDot({ status }: { status: PaperRowStatus }) {
  const label = inFlightLabel(status);
  const tone =
    status === "failed"
      ? "bg-[var(--sienna)]"
      : label
        ? "bg-[var(--gold)]"
        : null;

  if (!tone) {
    return <span aria-hidden="true" className="block size-1.5 shrink-0" />;
  }

  return (
    <span
      aria-hidden="true"
      className={cn("block size-1.5 shrink-0 rounded-full", tone)}
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
    // errorMessage 是引擎抛出的原始英文串(queue-consumer 直接落库),
    // 不带任何「失败」字样。不加前缀的话,失败态就只剩赭色一种信号 ——
    // 对读屏用户是 WCAG 1.4.1 违规,对明眼用户是一段没有标题的堆栈碎片。
    return {
      text: errorMessage
        ? `${m.papers_status_failed()}: ${errorMessage}`
        : m.papers_status_failed(),
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
