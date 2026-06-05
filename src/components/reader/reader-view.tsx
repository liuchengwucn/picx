import { FilePlus2, FileText, List, X } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { MarkdownArticle } from "./markdown-article";
import { ReaderSettingsMenu } from "./reader-settings";
import { TocList, useToc } from "./reader-toc";
import { useReaderSettings } from "./use-reader-settings";

interface ReaderViewProps {
  title: string;
  markdown: string;
  pdfUrl: string | null;
  onNew: () => void;
}

export function ReaderView({
  title,
  markdown,
  pdfUrl,
  onNew,
}: ReaderViewProps) {
  const articleRef = useRef<HTMLElement>(null);
  const { settings, update, reset } = useReaderSettings();
  const { items, activeId, jumpTo } = useToc(articleRef, markdown);
  const [tocOpen, setTocOpen] = useState(false);

  const handleJump = (id: string) => {
    jumpTo(id);
    setTocOpen(false);
  };

  return (
    <div className="reader-shell">
      <div className="reader-toolbar">
        <div className="reader-toolbar-inner">
          <button type="button" className="reader-tool-btn" onClick={onNew}>
            <FilePlus2 className="h-4 w-4" />
            <span className="hidden sm:inline">{m.reader_new_document()}</span>
          </button>

          <h1 className="reader-toolbar-title" title={title}>
            {title}
          </h1>

          <div className="ml-auto flex items-center gap-1.5">
            {items.length > 0 ? (
              <button
                type="button"
                className="reader-tool-btn lg:hidden"
                onClick={() => setTocOpen(true)}
                aria-label={m.reader_toc()}
              >
                <List className="h-4 w-4" />
              </button>
            ) : null}
            {pdfUrl ? (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="reader-tool-btn no-underline"
              >
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">{m.reader_view_pdf()}</span>
              </a>
            ) : null}
            <ReaderSettingsMenu
              settings={settings}
              onChange={update}
              onReset={reset}
            />
          </div>
        </div>
        <ReadingProgress targetRef={articleRef} />
      </div>

      <div className="reader-layout">
        <aside className="reader-sidebar">
          <span className="reader-sidebar-heading">{m.reader_toc()}</span>
          <div className="reader-sidebar-scroll">
            <TocList items={items} activeId={activeId} onJump={handleJump} />
          </div>
        </aside>

        <div className="min-w-0">
          <MarkdownArticle
            markdown={markdown}
            settings={settings}
            articleRef={articleRef}
          />
        </div>

        <div className="reader-rail-balance" aria-hidden />
      </div>

      {/* 移动端目录抽屉 */}
      {tocOpen ? (
        <div className="reader-drawer-root lg:hidden">
          <button
            type="button"
            aria-label="Close contents"
            className="reader-drawer-backdrop"
            onClick={() => setTocOpen(false)}
          />
          <div className="reader-drawer-panel">
            <div className="reader-drawer-head">
              <span className="reader-sidebar-heading">{m.reader_toc()}</span>
              <button
                type="button"
                className="reader-tool-btn"
                onClick={() => setTocOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="reader-drawer-scroll">
              <TocList items={items} activeId={activeId} onJump={handleJump} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReadingProgress({
  targetRef,
}: {
  targetRef: RefObject<HTMLElement | null>;
}) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    const compute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = targetRef.current;
        if (!el) {
          return;
        }
        const rect = el.getBoundingClientRect();
        const total = el.offsetHeight - window.innerHeight;
        const scrolled = -rect.top;
        const ratio = total > 0 ? scrolled / total : 0;
        setProgress(Math.min(1, Math.max(0, ratio)));
      });
    };
    compute();
    window.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", compute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
    };
  }, [targetRef]);

  return (
    <div className="reader-progress" aria-hidden>
      <div
        className={cn("reader-progress-fill")}
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}
