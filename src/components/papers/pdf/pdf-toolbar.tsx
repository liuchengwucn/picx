import { Download, List, Minus, Plus, Search } from "lucide-react";
import { useRef, useState } from "react";
import { ICON_BTN, TOOL_BTN } from "#/components/reader/reader-ui";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

/** 禁用态：连 hover 位移一起关掉，否则点不动的按钮还在跟着鼠标动。 */
const DISABLED_BTN =
  "disabled:cursor-not-allowed disabled:opacity-40 " +
  "disabled:hover:translate-y-0 disabled:hover:border-[var(--line)]";

/** 总页数的无障碍描述节点 id。一页只会有一个 PDF 工具栏，静态 id 够用。 */
const PAGE_TOTAL_ID = "pdf-page-total";

export interface PdfToolbarProps {
  title: string;
  downloadUrl: string;
  /** 下载时的文件名；不给的话浏览器会拿 R2 key 当文件名 */
  downloadName: string;
  /** 文档是否已就绪。未就绪时除标题与下载外全部禁用，理由见组件注释 */
  ready: boolean;
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
 * 加载/出错期间只留标题与下载可用，其余全部禁用。这不是装饰：遮罩是绝对定位浮层，
 * 只挡视觉与指针、不挡焦点，Tab 能直接走进工具栏。而无文档时 `viewer.currentScale`
 * 的 getter 返回 DEFAULT_SCALE=1、setter 却直接 return，于是「加载中按一下放大」会
 * 把 usePdfViewer 里的 scaleValue 从 page-width 改成数字倍率却什么都没渲染——文档
 * 加载完会以 110% 打开，而且 ResizeObserver 里「只有 page-width 才跟着容器走」的分支
 * 从此不再命中，拖 chat 栏不再重适宽。用户完全无从察觉。
 *
 * 纯 props 组件：不碰 pdfjs，也不自己持有任何 PDF 状态。
 */
export function PdfToolbar({
  title,
  downloadUrl,
  downloadName,
  ready,
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
  // - 聚焦即进入编辑态，编辑期间外部页码一律不回写。滚动会持续派发 pagechanging，
  //   而用户点进输入框想跳页时页面往往还在惯性滚动，任何形式的回填都会一帧一帧地
  //   把正在输入的内容冲掉。
  // - 回车提交，提交完立刻 blur 把所有权交还回去。少了这一下 blur，编辑态会一直
  //   挂着，指示器就永远不再跟踪文档了——跳到某页再接着往下读是最普通的流程。
  // - 失焦时「敲过键就提交、没敲过就取消」。不能简单地一律取消：iOS Safari 对
  //   inputMode="numeric" 弹的是纯数字小键盘，上面没有 Return/Go 键，失焦是 iPhone
  //   上唯一的提交路径，一律取消等于这个控件在 iPhone 上彻底没法用。也不能一律
  //   提交：只是点进来看看又点走时，draft 里那个页码很可能已被滚动甩在后面，提交
  //   等于把视图硬拽回去。
  //
  // draft 原样回显、不做任何规范化：本项目在 news 与 gallery 都踩过「受控输入框
  // 回填吃掉尾部空格」，只要显示值是从 draft 派生出来的就会复现。
  const [draft, setDraft] = useState<string | null>(null);
  // 用户在这次编辑里到底敲过东西没有。
  //
  // 主要靠 keydown 置位而不是只靠 onChange：React 的受控输入在新值与旧值相同时会
  // 吞掉 onChange（inputValueTracking），「全选后重敲同一个数字」根本不触发
  // onChange，只认 onChange 的话这次跳页请求会被静默丢掉。onChange 那边也置位是为
  // 了兜住右键粘贴、拖放这类没有按键的输入。
  //
  // 刻意不是「比对聚焦时的页码判断改没改」：基准值会因为焦点期间的滚动而过期，
  // 于是「重新输入基准值」和「压根没输入」无法区分。
  const touchedRef = useRef(false);

  const release = () => {
    touchedRef.current = false;
    setDraft(null);
  };

  const commit = () => {
    if (draft === null) return;
    // 值就是当前页时别调 goToPage：pdfjs 的 currentPageNumber setter 会走
    // resetCurrentPageView 把视图弹回该页顶部，用户读到页面中段的位置就丢了。
    if (draft === String(pageNumber)) return;
    const next = Number(draft);
    if (Number.isInteger(next) && next >= 1 && next <= pageCount) {
      onGoToPage(next);
    }
  };

  const percent = Math.round(scale * 100);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--parchment)] px-3 py-2">
      {/* min-w 兜底：没有它 flex-1 会在窄屏把标题压成 0 宽，直接消失 */}
      {/* 用 h1 而不是 h2：PDF 态下页面既不渲染 aside 也不渲染 ReaderPane，它们各自
          的 h1 都不在，全页标题层级会从 h2 起跳，读屏按标题导航会看到一个悬空节点。 */}
      <h1
        className="min-w-[8rem] flex-1 truncate font-serif text-sm font-semibold text-[var(--ink)]"
        title={title}
      >
        {title}
      </h1>

      {/* 控件簇整体右对齐：窄屏放不下时先由外层 flex-wrap 把它整条挪到第二行，
          第二行还是放不下（三位数页码、三位数倍率）就由自身的 flex-wrap 再折一次。
          少了这层兜底，375px 下最右边的下载按钮会被面板的 overflow-hidden 切掉。 */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1 sm:gap-1.5">
        {hasOutline && (
          <button
            type="button"
            className={cn(TOOL_BTN, ICON_BTN, DISABLED_BTN)}
            disabled={!ready}
            onClick={onOpenOutline}
            aria-label={m.pdf_outline()}
            title={m.pdf_outline()}
          >
            <List className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          className={cn(TOOL_BTN, ICON_BTN, DISABLED_BTN)}
          disabled={!ready}
          onClick={onToggleFind}
          aria-label={m.pdf_search()}
          title={m.pdf_search()}
        >
          <Search className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-0.5 text-xs text-[var(--ink-soft)] sm:gap-1">
          <input
            value={draft ?? String(pageNumber)}
            disabled={!ready}
            onFocus={() => setDraft(String(pageNumber))}
            onChange={(event) => {
              touchedRef.current = true;
              setDraft(event.target.value);
            }}
            onBlur={() => {
              if (touchedRef.current) commit();
              release();
            }}
            onKeyDown={(event) => {
              // 中日文输入法组字中的 Enter 是「确认候选」不是「提交」。不拦住的话，
              // 平假名模式下敲出来的全角数字会被当成非法值丢掉，连焦点一起消失。
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                release();
                event.currentTarget.blur();
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
                // onBlur 会走 release()；此时 touched 仍是 true，但 commit 幂等，
                // 重复一次不会有额外效果
                event.currentTarget.blur();
                return;
              }
              // 修饰键组合（全选、复制）不算编辑；Cmd+V 粘贴会触发 onChange，那边置位
              if (event.ctrlKey || event.metaKey) return;
              if (
                event.key.length === 1 ||
                event.key === "Backspace" ||
                event.key === "Delete"
              ) {
                touchedRef.current = true;
              }
            }}
            inputMode="numeric"
            aria-label={m.pdf_page_input_label()}
            aria-describedby={PAGE_TOTAL_ID}
            className={cn(
              "w-9 rounded-md border border-[var(--line)] bg-[var(--surface-strong)] px-1 py-0.5 text-center text-xs tabular-nums text-[var(--ink)] outline-none focus:border-[var(--academic-brown)] sm:w-10",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          />
          {/* 可见的「/ 18」读屏念出来是「斜杠 18」，语义不清；描述文案单独给一份 */}
          <span aria-hidden="true" className="tabular-nums">
            / {pageCount || "–"}
          </span>
          <span id={PAGE_TOTAL_ID} className="sr-only">
            {m.pdf_page_total({ total: pageCount })}
          </span>
        </div>

        <button
          type="button"
          className={cn(TOOL_BTN, ICON_BTN, DISABLED_BTN)}
          disabled={!ready}
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
            DISABLED_BTN,
            "min-w-12 justify-center tabular-nums sm:min-w-14",
          )}
          disabled={!ready}
          onClick={onFitWidth}
          aria-label={`${m.pdf_fit_width()} (${percent}%)`}
          title={m.pdf_fit_width()}
        >
          {percent}%
        </button>
        <button
          type="button"
          className={cn(TOOL_BTN, ICON_BTN, DISABLED_BTN)}
          disabled={!ready}
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
