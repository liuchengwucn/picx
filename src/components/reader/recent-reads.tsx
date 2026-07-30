import { Clock, FileText, Link, Trash2 } from "lucide-react";
import { formatRelative } from "#/lib/relative-time";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";
import type { ReaderHistoryEntry } from "./reader-history";

interface RecentReadsProps {
  entries: ReaderHistoryEntry[];
  onOpen: (entry: ReaderHistoryEntry) => void;
  onRemove: (id: string) => void;
}

export function RecentReads({ entries, onOpen, onRemove }: RecentReadsProps) {
  if (entries.length === 0) {
    return null;
  }
  const now = Date.now();
  const locale = getLocale();

  return (
    <section className="stagger-in mx-auto mt-12 w-[min(640px,100%)]">
      {/* 与 UploadZone 的 "or" 分隔同源:细线 + 居中大写小标题 */}
      <div className="relative mb-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-[var(--line)]" />
        <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
          {m.reader_recent_title()}
        </h2>
        <div className="h-px flex-1 bg-[var(--line)]" />
      </div>

      <ul className="flex flex-col gap-1.5">
        {entries.map((entry) => (
          <li key={entry.id}>
            <div className="group relative flex items-center gap-3 overflow-hidden rounded-[14px] border border-[var(--line)] bg-[linear-gradient(165deg,var(--surface-strong),var(--surface))] px-3.5 py-3 shadow-[0_2px_10px_rgba(45,42,36,0.05)] transition-[border-color,transform,box-shadow] duration-[180ms] hover:-translate-y-px hover:border-[var(--academic-brown)] hover:shadow-[0_8px_24px_rgba(45,42,36,0.1)] focus-within:-translate-y-px focus-within:border-[var(--academic-brown)] focus-within:shadow-[0_8px_24px_rgba(45,42,36,0.1)]">
              <button
                type="button"
                onClick={() => onOpen(entry)}
                className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 bg-transparent text-left outline-none"
              >
                <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-[family-name:var(--reader-serif)] text-[0.96rem] font-semibold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown-deep)] group-focus-within:text-[var(--academic-brown-deep)]">
                  {entry.title}
                </span>
                <span className="flex max-w-full items-center gap-2 text-[0.72rem] text-[var(--ink-soft)]">
                  <span className="inline-flex shrink-0 items-center gap-1">
                    <Clock className="h-3 w-3" aria-hidden />
                    {formatRelative(entry.lastReadAt, now, locale)}
                  </span>
                  <span
                    className="h-2.5 w-px shrink-0 bg-[var(--line)]"
                    aria-hidden
                  />
                  <span className="inline-flex min-w-0 items-center gap-1">
                    {entry.source.kind === "url" ? (
                      <Link className="h-3 w-3 shrink-0" aria-hidden />
                    ) : (
                      <FileText className="h-3 w-3 shrink-0" aria-hidden />
                    )}
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      {entry.source.name}
                    </span>
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(entry.id)}
                aria-label={m.reader_recent_delete()}
                title={m.reader_recent_delete()}
                className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-[8px] border border-transparent bg-transparent text-[var(--ink-soft)] opacity-0 outline-none transition-[opacity,color,background,border-color] duration-150 hover:border-[var(--line)] hover:bg-[var(--parchment)] hover:text-[var(--sienna)] focus-visible:opacity-100 focus-visible:border-[var(--academic-brown)] group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
