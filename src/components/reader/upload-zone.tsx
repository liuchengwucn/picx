import {
  FileText,
  FunctionSquare,
  Link,
  Puzzle,
  UploadCloud,
} from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { isAllowedPdfUrl } from "#/lib/pdf-url";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { PRIMARY_BTN } from "./reader-ui";

const MAX_PDF_BYTES = 100 * 1024 * 1024;

interface UploadZoneProps {
  onFile: (file: File) => void;
  onUrl: (url: string) => void;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export function UploadZone({ onFile, onUrl }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  const submitUrl = () => {
    const trimmed = url.trim();
    if (!trimmed || !isAllowedPdfUrl(trimmed).ok) {
      setError(m.reader_err_url());
      return;
    }
    setError(null);
    onUrl(trimmed);
  };

  const accept = (file: File | undefined | null) => {
    if (!file) {
      return;
    }
    if (!isPdf(file)) {
      setError(m.reader_err_type());
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setError(m.reader_err_size());
      return;
    }
    setError(null);
    onFile(file);
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(false);
    accept(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="page-wrap py-12 sm:py-20">
      <div className="stagger-in mx-auto max-w-2xl text-center">
        <span className="inline-block rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-[0.85rem] py-[0.35rem] text-[0.72rem] font-bold uppercase tracking-[0.22em] text-[var(--academic-brown)]">
          {m.reader_eyebrow()}
        </span>
        <h1 className="display-title mt-4 text-balance text-4xl font-bold leading-[1.08] tracking-tight text-[var(--ink)] sm:text-5xl">
          {m.reader_hero_title()}
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-[var(--ink-soft)] sm:text-lg">
          {m.reader_hero_subtitle()}
        </p>
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: 拖拽区,主操作由内部 button 触发 */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 同上,键盘可达性由内部 button 提供 */}
      <div
        data-dragging={dragging || undefined}
        className={cn(
          "group stagger-in relative mx-auto mt-10 flex w-[min(640px,100%)] cursor-pointer flex-col items-center overflow-hidden rounded-[22px] border-[1.5px] border-dashed border-[color-mix(in_srgb,var(--academic-brown)_45%,transparent)] bg-[linear-gradient(165deg,var(--surface-strong),var(--surface))] px-6 py-12 text-center shadow-[0_2px_18px_rgba(45,42,36,0.07)] [transition:border-color_200ms_ease,box-shadow_240ms_ease,transform_240ms_cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-[3px] hover:border-[var(--academic-brown)] hover:shadow-[0_12px_34px_rgba(45,42,36,0.12)]",
          dragging &&
            "-translate-y-[3px] border-solid border-[var(--gold)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--gold)_22%,transparent),0_14px_40px_rgba(45,42,36,0.16)]",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div
          className="pointer-events-none absolute inset-x-[30%] bottom-auto top-[-40%] h-[60%] bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--gold)_24%,transparent),transparent_70%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-data-[dragging]:opacity-100"
          aria-hidden
        />
        <div className="grid h-16 w-16 place-items-center rounded-[18px] bg-[linear-gradient(150deg,var(--academic-brown),var(--academic-brown-deep))] text-white shadow-[0_8px_22px_rgba(139,111,71,0.32)]">
          <UploadCloud className="h-8 w-8" />
        </div>
        <p className="mt-5 text-lg font-semibold text-[var(--ink)]">
          {m.reader_drop_title()}
        </p>
        <p className="mt-1.5 text-sm text-[var(--ink-soft)]">
          {m.reader_drop_hint()}
        </p>
        <button
          type="button"
          className={cn(PRIMARY_BTN, "mt-6")}
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          <FileText className="h-4 w-4" />
          {m.reader_drop_button()}
        </button>
        <p className="mt-4 text-xs text-[var(--ink-soft)]">
          {m.reader_drop_note()}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            accept(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {/* URL input row */}
      <div className="mx-auto mt-5 w-[min(640px,100%)]">
        {/* "or" divider */}
        <div className="relative mb-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--line)]" />
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
            or
          </span>
          <div className="h-px flex-1 bg-[var(--line)]" />
        </div>

        <div className="flex items-stretch gap-2">
          <div className="relative min-w-0 flex-auto">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--ink-soft)]">
              <Link className="h-4 w-4" />
            </span>
            <input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  submitUrl();
                }
              }}
              placeholder={m.reader_url_placeholder()}
              aria-label={m.reader_url_label()}
              className="w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface)] py-3 pl-9 pr-4 text-sm text-[var(--ink)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--ink-soft)] focus:border-[var(--academic-brown)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--academic-brown)_14%,transparent)]"
            />
          </div>
          <button
            type="button"
            className={cn(PRIMARY_BTN, "shrink-0")}
            onClick={submitUrl}
          >
            {m.reader_url_button()}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mx-auto mt-4 max-w-xl text-center text-sm font-medium text-[var(--destructive)]">
          {error}
        </p>
      ) : null}

      <div className="stagger-in mx-auto mt-12 grid max-w-3xl gap-4 sm:grid-cols-3">
        <Feature
          icon={<FunctionSquare className="h-4 w-4" />}
          title={m.reader_feature_formula_title()}
          body={m.reader_feature_formula_body()}
        />
        <Feature
          icon={<Puzzle className="h-4 w-4" />}
          title={m.reader_feature_translate_title()}
          body={m.reader_feature_translate_body()}
        />
        <Feature
          icon={<FileText className="h-4 w-4" />}
          title={m.reader_feature_responsive_title()}
          body={m.reader_feature_responsive_body()}
        />
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-[1.15rem] py-[1.1rem] text-left">
      <span className="inline-grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-[color-mix(in_srgb,var(--academic-brown)_12%,transparent)] text-[var(--academic-brown-deep)]">
        {icon}
      </span>
      <h3 className="mt-3 text-sm font-semibold text-[var(--ink)]">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
        {body}
      </p>
    </div>
  );
}
