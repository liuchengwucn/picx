import {
  FilePlus2,
  FileText,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { MarkdownArticle } from "#/components/markdown-reader/markdown-article";
import { ReaderSettingsMenu } from "#/components/markdown-reader/reader-settings";
import { TocList, useToc } from "#/components/markdown-reader/reader-toc";
import { useReaderSettings } from "#/components/markdown-reader/use-reader-settings";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { TOOL_BTN } from "./reader-ui";

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
  const [tocCollapsed, setTocCollapsed] = useState(false);

  // 无标题可生成目录时,桌面端也并为单栏(不留空白边栏)。
  const hideSidebar = tocCollapsed || items.length === 0;

  const handleJump = (id: string) => {
    jumpTo(id);
    setTocOpen(false);
  };

  return (
    <div className="w-full">
      <div className="sticky top-[56px] z-30 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--parchment)_86%,transparent)] backdrop-blur-[12px] sm:top-[68px]">
        <div className="mx-auto flex w-[min(1280px,100%)] items-center gap-2 px-4 py-[0.6rem] min-[1440px]:w-[min(1600px,100%)]">
          <button
            type="button"
            className={cn(TOOL_BTN, "flex-shrink-0")}
            onClick={onNew}
          >
            <FilePlus2 className="h-4 w-4" />
            <span className="hidden sm:inline">{m.reader_new_document()}</span>
          </button>

          <h1
            className="m-0 max-w-[clamp(8rem,38vw,36rem)] overflow-hidden text-ellipsis whitespace-nowrap font-[family-name:var(--reader-serif)] text-[0.95rem] font-semibold leading-none text-[var(--ink)]"
            title={title}
          >
            {title}
          </h1>

          <div className="ml-auto flex items-center gap-1.5">
            {items.length > 0 ? (
              <button
                type="button"
                className={cn(TOOL_BTN, "lg:hidden")}
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
                className={cn(TOOL_BTN, "no-underline")}
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

      <div
        className={cn(
          "mx-auto w-[min(1280px,100%)] px-4 lg:grid lg:items-start lg:gap-10 min-[1440px]:w-[min(1600px,100%)]",
          hideSidebar
            ? "lg:grid-cols-[minmax(0,1fr)] min-[1440px]:grid-cols-[minmax(0,1fr)]"
            : "lg:grid-cols-[16rem_minmax(0,1fr)] min-[1440px]:grid-cols-[16rem_minmax(0,1fr)_16rem]",
        )}
      >
        {hideSidebar ? null : (
          <aside className="hidden lg:sticky lg:top-[96px] lg:block lg:max-h-[calc(100vh-120px)] lg:pt-10">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                {m.reader_toc()}
              </span>
              <button
                type="button"
                className="grid h-7 w-7 cursor-pointer place-items-center rounded-[7px] border border-transparent bg-transparent text-[var(--ink-soft)] transition-[color,background,border-color] duration-150 hover:border-[var(--line)] hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
                onClick={() => setTocCollapsed(true)}
                aria-label={m.reader_toc_hide()}
                title={m.reader_toc_hide()}
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <div className="lg:mt-3 lg:max-h-[calc(100vh-170px)] lg:overflow-y-auto lg:pr-2">
              <TocList items={items} activeId={activeId} onJump={handleJump} />
            </div>
          </aside>
        )}

        <div className="min-w-0">
          <MarkdownArticle
            markdown={markdown}
            settings={settings}
            articleRef={articleRef}
          />
        </div>

        <div
          className={cn("hidden", !hideSidebar && "min-[1440px]:block")}
          aria-hidden
        />
      </div>

      {/* 收起目录后,左侧留一个重新展开的吸附按钮(仅桌面) */}
      {tocCollapsed && items.length > 0 ? (
        <button
          type="button"
          className="hidden lg:fixed lg:left-0 lg:top-[140px] lg:z-[25] lg:inline-flex lg:cursor-pointer lg:items-center lg:gap-[0.4rem] lg:rounded-r-[12px] lg:border lg:border-l-0 lg:border-[var(--line)] lg:bg-[var(--surface-strong)] lg:py-2 lg:pl-2 lg:pr-[0.7rem] lg:text-[0.8rem] lg:font-semibold lg:text-[var(--ink)] lg:shadow-[4px_4px_16px_rgba(45,42,36,0.1)] lg:transition-[transform,background,color] lg:duration-[160ms] lg:hover:translate-x-[2px] lg:hover:bg-[var(--parchment)] lg:hover:text-[var(--academic-brown-deep)]"
          onClick={() => setTocCollapsed(false)}
          aria-label={m.reader_toc_show()}
          title={m.reader_toc_show()}
        >
          <PanelLeftOpen className="h-4 w-4" />
          <span className="tracking-[0.02em]">{m.reader_toc()}</span>
        </button>
      ) : null}

      {/* 移动端目录抽屉 */}
      {tocOpen ? (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            aria-label="Close contents"
            className="absolute inset-0 bg-[rgba(20,18,15,0.42)] backdrop-blur-[2px] animate-in fade-in duration-200"
            onClick={() => setTocOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[min(82vw,20rem)] flex-col border-r border-[var(--line)] bg-[var(--parchment)] px-[0.85rem] py-4 shadow-[12px_0_40px_rgba(20,18,15,0.24)] animate-in slide-in-from-left duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)]">
            <div className="flex items-center justify-between px-[0.4rem] pb-3 pt-1">
              <span className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                {m.reader_toc()}
              </span>
              <button
                type="button"
                className={TOOL_BTN}
                onClick={() => setTocOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
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
    <div className="h-[2px] w-full overflow-hidden bg-transparent" aria-hidden>
      <div
        className="h-full w-full origin-left bg-[linear-gradient(90deg,var(--academic-brown),var(--gold))] transition-transform duration-[80ms] ease-linear"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}
