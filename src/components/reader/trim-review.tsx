import {
  ArrowRight,
  FileText,
  Loader2,
  ScanText,
  Scissors,
} from "lucide-react";
import type { TrimPlan } from "#/lib/pdf-trim";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { GHOST_BTN, PRIMARY_BTN, STATUS_CARD, STATUS_ICON } from "./reader-ui";

/** 上传前分析 PDF(查找可裁的尾部)时的等待卡片。 */
export function AnalyzingCard({ fileName }: { fileName: string | null }) {
  return (
    <div className="page-wrap flex min-h-[60vh] items-center justify-center py-12">
      <div className={cn(STATUS_CARD, "rise-in text-center")}>
        <span
          className={cn(
            STATUS_ICON,
            "bg-[color-mix(in_srgb,var(--academic-brown)_14%,transparent)] text-[var(--academic-brown-deep)]",
          )}
        >
          <ScanText className="h-7 w-7" />
        </span>
        <h2 className="mt-5 text-xl font-semibold text-[var(--ink)]">
          {m.reader_analyzing_title()}
        </h2>
        {fileName ? (
          <p className="mx-auto mt-2 max-w-xs truncate text-sm text-[var(--ink-soft)]">
            {fileName}
          </p>
        ) : null}
        <div className="mt-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--academic-brown)]" />
        </div>
        <p className="mx-auto mt-6 max-w-xs text-xs leading-relaxed text-[var(--ink-soft)]">
          {m.reader_analyzing_hint()}
        </p>
      </div>
    </div>
  );
}

interface TrimReviewProps {
  fileName: string | null;
  plan: TrimPlan;
  busy: boolean;
  onConfirmTrim: () => void;
  onUploadFull: () => void;
  onCancel: () => void;
}

/** 裁剪预览:展示「原 X 页 → 上传 M 页」,默认裁剪并提供「上传完整版」退路。 */
export function TrimReview({
  fileName,
  plan,
  busy,
  onConfirmTrim,
  onUploadFull,
  onCancel,
}: TrimReviewProps) {
  return (
    <div className="page-wrap flex min-h-[60vh] items-center justify-center py-12">
      <div className={cn(STATUS_CARD, "rise-in text-center")}>
        <span
          className={cn(
            STATUS_ICON,
            "bg-[color-mix(in_srgb,var(--academic-brown)_14%,transparent)] text-[var(--academic-brown-deep)]",
          )}
        >
          <Scissors className="h-7 w-7" />
        </span>
        <h2 className="mt-5 text-xl font-semibold text-[var(--ink)]">
          {m.reader_trim_title()}
        </h2>
        {fileName ? (
          <p className="mx-auto mt-2 max-w-xs truncate text-sm text-[var(--ink-soft)]">
            {fileName}
          </p>
        ) : null}

        <div className="mt-[1.4rem] inline-flex items-center gap-[0.6rem] rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-4 py-[0.45rem] text-[1.5rem] font-bold leading-none tabular-nums">
          <span className="text-[var(--ink-soft)] line-through decoration-[color-mix(in_srgb,var(--sienna)_60%,transparent)]">
            {plan.totalPages}
          </span>
          <ArrowRight className="h-[18px] w-[18px] text-[var(--ink-soft)]" />
          <span className="text-[var(--academic-brown-deep)]">
            {plan.keptPages}
          </span>
        </div>

        <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-[var(--ink-soft)]">
          {m.reader_trim_summary({
            heading: plan.headingText,
            page: plan.cutPageNumber,
            kept: plan.keptPages,
            total: plan.totalPages,
          })}
        </p>

        <div className="mt-6 flex flex-col gap-[0.6rem] min-[420px]:flex-row min-[420px]:justify-center">
          <button
            type="button"
            className={cn(PRIMARY_BTN, "justify-center")}
            disabled={busy}
            onClick={onConfirmTrim}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Scissors className="h-4 w-4" />
            )}
            {m.reader_trim_confirm({ kept: plan.keptPages })}
          </button>
          <button
            type="button"
            className={cn(GHOST_BTN, "justify-center")}
            disabled={busy}
            onClick={onUploadFull}
          >
            <FileText className="h-4 w-4" />
            {m.reader_trim_full()}
          </button>
        </div>

        <button
          type="button"
          className="mt-[0.9rem] cursor-pointer border-0 bg-transparent text-[0.8rem] font-semibold text-[var(--ink-soft)] transition-colors duration-150 hover:text-[var(--academic-brown-deep)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          onClick={onCancel}
        >
          {m.reader_choose_other()}
        </button>

        <p className="mx-auto mt-5 max-w-sm text-xs leading-relaxed text-[var(--ink-soft)]">
          {m.reader_trim_note()}
        </p>
      </div>
    </div>
  );
}
