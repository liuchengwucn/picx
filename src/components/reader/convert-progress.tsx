import {
  AlertTriangle,
  Check,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

export type ProgressPhase = "uploading" | "processing" | "rendering" | "error";

interface ConvertProgressProps {
  phase: ProgressPhase;
  fileName: string | null;
  errorMessage?: string | null;
  onRetry: () => void;
  onReset: () => void;
}

const PHASE_TO_STEP: Record<Exclude<ProgressPhase, "error">, number> = {
  uploading: 0,
  processing: 1,
  rendering: 2,
};

export function ConvertProgress({
  phase,
  fileName,
  errorMessage,
  onRetry,
  onReset,
}: ConvertProgressProps) {
  if (phase === "error") {
    return (
      <div className="page-wrap flex min-h-[60vh] items-center justify-center py-12">
        <div className="reader-status-card rise-in text-center">
          <span className="reader-status-icon is-error">
            <AlertTriangle className="h-7 w-7" />
          </span>
          <h2 className="mt-5 text-xl font-semibold text-[var(--ink)]">
            {m.reader_error_title()}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--ink-soft)]">
            {errorMessage || m.reader_error_generic()}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              className="reader-primary-btn"
              onClick={onRetry}
            >
              <RefreshCw className="h-4 w-4" />
              {m.reader_retry()}
            </button>
            <button
              type="button"
              className="reader-ghost-btn"
              onClick={onReset}
            >
              <RotateCcw className="h-4 w-4" />
              {m.reader_choose_other()}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeStep = PHASE_TO_STEP[phase];
  const steps = [
    m.reader_step_upload(),
    m.reader_step_parse(),
    m.reader_step_render(),
  ];

  return (
    <div className="page-wrap flex min-h-[60vh] items-center justify-center py-12">
      <div className="reader-status-card rise-in text-center">
        <span className="reader-status-icon">
          <FileText className="h-7 w-7" />
        </span>
        <h2 className="mt-5 text-xl font-semibold text-[var(--ink)]">
          {m.reader_progress_title()}
        </h2>
        {fileName ? (
          <p className="mx-auto mt-2 max-w-xs truncate text-sm text-[var(--ink-soft)]">
            {fileName}
          </p>
        ) : null}

        <ol className="reader-steps mt-8">
          {steps.map((label, index) => {
            const state =
              index < activeStep
                ? "done"
                : index === activeStep
                  ? "active"
                  : "pending";
            return (
              <li key={label} className={cn("reader-step", `is-${state}`)}>
                <span className="reader-step-dot">
                  {state === "done" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : state === "active" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span className="reader-step-num">{index + 1}</span>
                  )}
                </span>
                <span className="reader-step-label">{label}</span>
              </li>
            );
          })}
        </ol>

        <p className="mt-7 text-xs text-[var(--ink-soft)]">
          {m.reader_progress_hint()}
        </p>
      </div>
    </div>
  );
}
