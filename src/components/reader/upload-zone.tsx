import { FileText, FunctionSquare, Languages, UploadCloud } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

const MAX_PDF_BYTES = 100 * 1024 * 1024;

interface UploadZoneProps {
  onFile: (file: File) => void;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export function UploadZone({ onFile }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <span className="reader-eyebrow">{m.reader_eyebrow()}</span>
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
        className={cn(
          "reader-dropzone stagger-in mt-10",
          dragging && "is-dragging",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div className="reader-dropzone-glow" aria-hidden />
        <div className="reader-dropzone-icon">
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
          className="reader-primary-btn mt-6"
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
          icon={<Languages className="h-4 w-4" />}
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
    <div className="reader-feature">
      <span className="reader-feature-icon">{icon}</span>
      <h3 className="mt-3 text-sm font-semibold text-[var(--ink)]">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
        {body}
      </p>
    </div>
  );
}
