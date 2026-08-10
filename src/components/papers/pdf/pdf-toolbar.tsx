import { Download, List, Minus, Plus, Search } from "lucide-react";
import { useState } from "react";
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
  // 页码输入框的编辑态。null = 没在编辑，显示值实时跟随 pageNumber。
  //
  // 提交语义刻意做成「回车提交、失焦取消」这一对，而不是去猜「用户到底改没改」：
  //
  // - 聚焦即进入编辑态，编辑期间外部页码一律不回写。滚动会持续派发 pagechanging，
  //   而用户点进输入框想跳页时页面往往还在惯性滚动，任何形式的回填都会一帧一帧地
  //   把正在输入的内容冲掉。
  // - 回车无条件提交后立刻 blur，把所有权交还回去。少了这一下 blur，编辑态会一直
  //   挂着，指示器就永远不再跟踪文档了——跳到某页再接着往下读是最普通的流程。
  // - 失焦一律取消、不提交。这样「点进来看看又点走」不会拿一个已被滚动甩在后面的
  //   页码把视图硬拽回去，「输了一半改主意点别处」也不会误跳。
  //
  // 代价是「输完不按回车、直接点别处」不会跳；回车是这个控件的主交互路径，可预测
  // 地不跳好过偶发地乱跳。反过来，任何「比对基准值判断是否编辑过」的做法都有洞：
  // 基准值取聚焦那一刻的页码，而焦点期间页码会漂移，于是「重新输入基准值」和「压根
  // 没输入」无法区分，第一次请求会被静默丢掉；改成 onChange 里置标志位也一样——
  // React 的受控输入在新值与旧值相同时会吞掉 onChange（inputValueTracking），
  // 全选后重敲同一个数字标志位根本不会被置上。
  //
  // draft 原样回显、不做任何规范化：本项目在 news 与 gallery 都踩过「受控输入框
  // 回填吃掉尾部空格」，只要显示值是从 draft 派生出来的就会复现。
  const [draft, setDraft] = useState<string | null>(null);

  const submit = (input: HTMLInputElement) => {
    if (draft !== null) {
      const next = Number(draft);
      if (Number.isInteger(next) && next >= 1 && next <= pageCount) {
        onGoToPage(next);
      }
    }
    // blur 会走到 onBlur，由那里统一把 draft 清成 null
    input.blur();
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
            onFocus={() => setDraft(String(pageNumber))}
            onChange={(event) => setDraft(event.target.value)}
            // 失焦一律取消：交还所有权，显示值回到实时跟随 pageNumber
            onBlur={() => setDraft(null)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit(event.currentTarget);
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

        {/* TOOL_BTN 是给 <button> 写的，套在 <a> 上颜色会跑偏：styles.css 里那条裸的
            `a { color: … }` 没进 @layer，按层叠顺序压过 @layer utilities 里的
            text-[var(--ink)]，图标会变成学术棕。下划线其实已被 Tailwind preflight
            重置掉，no-underline 只是与 reader-view.tsx 的既有写法保持一致。 */}
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
