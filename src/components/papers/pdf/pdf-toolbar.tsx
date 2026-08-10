import { Download, List, Minus, Plus, Search } from "lucide-react";
import { useRef, useState } from "react";
import { TOOL_BTN } from "#/components/reader/reader-ui";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

/** 图标独占的小按钮：把 TOOL_BTN 的横向内距收成正方形。 */
const ICON_BTN = "px-[0.45rem] py-[0.45rem]";

export interface PdfToolbarProps {
  title: string;
  downloadUrl: string;
  /** 下载时的文件名；不给的话浏览器会拿 R2 key 当文件名 */
  downloadName: string;
  pageNumber: number;
  pageCount: number;
  scale: number;
  hasOutline: boolean;
  onOpenOutline: () => void;
  onToggleFind: () => void;
  onGoToPage: (page: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
}

/**
 * PDF 面板顶部的常驻工具栏。PDF 视图下左栏被砍掉了，所以论文标题与下载入口也落在
 * 这里——那是原来左栏元信息卡承担的职责。状态徽章不放：PDF tab 只在 completed 下
 * 可用，徽章恒为「已完成」，是噪音。
 *
 * 纯 props 组件：不碰 pdfjs，也不自己持有任何 PDF 状态。
 */
export function PdfToolbar({
  title,
  downloadUrl,
  downloadName,
  pageNumber,
  pageCount,
  scale,
  hasOutline,
  onOpenOutline,
  onToggleFind,
  onGoToPage,
  onZoomIn,
  onZoomOut,
  onFitWidth,
}: PdfToolbarProps) {
  // 页码输入框的编辑态。null = 没在编辑，显示值直接跟随 pageNumber；一旦聚焦就
  // 完全归用户所有，外部页码再变也绝不回写。
  //
  // 刻意不用「state 存字符串 + effect 从 pageNumber 回填」那套：滚动会持续派发
  // pagechanging，而用户点进输入框想跳页时页面往往还在惯性滚动，回填 effect 会
  // 一帧一帧地把正在输入的内容冲掉。
  //
  // 也刻意不靠「onChange 第一次触发才算进入编辑」：React 的受控输入在新值与旧值
  // 相同时会吞掉 onChange（inputValueTracking），全选后重敲同一个数字就进不了
  // 编辑态，后续按键会接在被滚动改写过的页码后面。改成聚焦即进入编辑，没有例外。
  //
  // draft 原样回显、不做任何规范化：本项目在 news 与 gallery 都踩过「受控输入框
  // 回填吃掉尾部空格」，只要显示值是从 draft 派生出来的就会复现。
  const [draft, setDraft] = useState<string | null>(null);
  // 聚焦那一刻的页码。用来判断「用户到底改没改」——只是点进来又点走的话不能提交，
  // 否则会拿一个已被滚动甩在后面的页码把视图硬拽回去。
  const seedRef = useRef("");

  const beginEdit = () => {
    seedRef.current = String(pageNumber);
    setDraft(seedRef.current);
  };

  const commit = () => {
    if (draft === null) return;
    if (draft !== seedRef.current) {
      const next = Number(draft);
      if (Number.isInteger(next) && next >= 1 && next <= pageCount) {
        onGoToPage(next);
        // 回车后输入框还在焦点里，编辑态得跟着落到新页码上
        seedRef.current = String(next);
        setDraft(seedRef.current);
        return;
      }
    }
    // 非法输入、或压根没改过：退回当下的真实页码
    seedRef.current = String(pageNumber);
    setDraft(seedRef.current);
  };

  const percent = Math.round(scale * 100);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--parchment)] px-3 py-2">
      {/* min-w 兜底：没有它 flex-1 会在窄屏把标题压成 0 宽，直接消失 */}
      <h2
        className="min-w-[8rem] flex-1 truncate font-serif text-sm font-semibold text-[var(--ink)]"
        title={title}
      >
        {title}
      </h2>

      {/* 控件簇整体右对齐：窄屏放不下时先由外层 flex-wrap 把它整条挪到第二行，
          第二行还是放不下（三位数页码、三位数倍率）就由自身的 flex-wrap 再折一次。
          少了这层兜底，375px 下最右边的下载按钮会被面板的 overflow-hidden 切掉。 */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1 sm:gap-1.5">
        {hasOutline && (
          <button
            type="button"
            className={cn(TOOL_BTN, ICON_BTN)}
            onClick={onOpenOutline}
            aria-label={m.pdf_outline()}
            title={m.pdf_outline()}
          >
            <List className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          className={cn(TOOL_BTN, ICON_BTN)}
          onClick={onToggleFind}
          aria-label={m.pdf_search()}
          title={m.pdf_search()}
        >
          <Search className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-0.5 text-xs text-[var(--ink-soft)] sm:gap-1">
          <input
            value={draft ?? String(pageNumber)}
            onFocus={beginEdit}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              commit();
              // 失焦即交还所有权，显示值回到跟随 pageNumber
              setDraft(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
            inputMode="numeric"
            aria-label={m.pdf_page_input_label()}
            className="w-9 rounded-md border border-[var(--line)] bg-[var(--surface-strong)] px-1 py-0.5 text-center text-xs tabular-nums text-[var(--ink)] outline-none focus:border-[var(--academic-brown)] sm:w-10"
          />
          <span className="tabular-nums">/ {pageCount || "–"}</span>
        </div>

        <button
          type="button"
          className={cn(TOOL_BTN, ICON_BTN)}
          onClick={onZoomOut}
          aria-label={m.pdf_zoom_out()}
          title={m.pdf_zoom_out()}
        >
          <Minus className="h-4 w-4" />
        </button>
        {/* 可见文字是倍率、动作却是「适应宽度」，两者都要进无障碍名称：
            只写倍率读屏用户不知道能点，只写动作又丢了当前倍率。 */}
        <button
          type="button"
          className={cn(
            TOOL_BTN,
            "min-w-12 justify-center tabular-nums sm:min-w-14",
          )}
          onClick={onFitWidth}
          aria-label={`${m.pdf_fit_width()} (${percent}%)`}
          title={m.pdf_fit_width()}
        >
          {percent}%
        </button>
        <button
          type="button"
          className={cn(TOOL_BTN, ICON_BTN)}
          onClick={onZoomIn}
          aria-label={m.pdf_zoom_in()}
          title={m.pdf_zoom_in()}
        >
          <Plus className="h-4 w-4" />
        </button>

        {/* TOOL_BTN 是给 <button> 写的，套在 <a> 上还差两笔：styles.css 里那条裸的
            `a { color: … }` 没进 @layer，按层叠顺序压过 @layer utilities 里的
            text-[var(--ink)]，图标会变成学术棕；下划线则来自 UA 样式表。 */}
        <a
          href={downloadUrl}
          download={downloadName}
          className={cn(TOOL_BTN, ICON_BTN, "text-[var(--ink)]! no-underline")}
          aria-label={m.paper_download_pdf()}
          title={m.paper_download_pdf()}
        >
          <Download className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}
