import {
  ArrowRight,
  FileText,
  Loader2,
  ScanText,
  Scissors,
} from "lucide-react";
import type { TrimPlan } from "#/lib/pdf-trim";
import { m } from "#/paraglide/messages";

/** 上传前分析 PDF(查找可裁的尾部)时的等待卡片。 */
export function AnalyzingCard({ fileName }: { fileName: string | null }) {
  return (
    <div className="page-wrap flex min-h-[60vh] items-center justify-center py-12">
      <div className="reader-status-card rise-in text-center">
        <span className="reader-status-icon">
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
      <div className="reader-status-card rise-in text-center">
        <span className="reader-status-icon">
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

        <div className="reader-trim-stat">
          <span className="reader-trim-stat-from">{plan.totalPages}</span>
          <ArrowRight className="reader-trim-stat-arrow" />
          <span className="reader-trim-stat-to">{plan.keptPages}</span>
        </div>

        <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-[var(--ink-soft)]">
          {m.reader_trim_summary({
            heading: plan.headingText,
            page: plan.cutPageNumber,
            kept: plan.keptPages,
            total: plan.totalPages,
          })}
        </p>

        <div className="reader-trim-actions">
          <button
            type="button"
            className="reader-primary-btn"
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
            className="reader-ghost-btn"
            disabled={busy}
            onClick={onUploadFull}
          >
            <FileText className="h-4 w-4" />
            {m.reader_trim_full()}
          </button>
        </div>

        <button
          type="button"
          className="reader-trim-cancel"
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
