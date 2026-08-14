import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ICON_BTN, TOOL_BTN } from "#/components/reader-ui";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import type { PdfOutlineNode } from "./use-pdf-viewer";

/** 缩进最多加到这一层：见 OutlineLevel 注释 */
const MAX_INDENT_DEPTH = 5;

/** 工具栏目录按钮的 aria-controls 指向这里。一页只有一个 PDF 面板，静态 id 够用。 */
export const PDF_OUTLINE_PANEL_ID = "pdf-outline-panel";

interface PdfOutlineDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PdfOutlineNode[];
  onJump: (dest: unknown) => void;
}

/**
 * pdf.js 的大纲节点：dest 为 null 时会带上 url/unsafeUrl（PDF 规范允许书签是 URI
 * action，见 core/catalog.js 的 #readDocumentOutline）。PdfOutlineNode 只声明了跳转
 * 需要的字段，这里把外链那一支单独取出来——仍不 import pdfjs。
 */
type OutlineItemWithUrl = PdfOutlineNode & { url?: string | null };

/**
 * PDF 内嵌大纲的抽屉。形态与 ReaderTocDrawer 一致（左滑面板 + 遮罩 + Esc 关闭），
 * 但有两处刻意的差别：
 *
 * 1. 没有 lg:hidden——PDF 视图任何断点下都没有常驻大纲栏（左栏被砍掉了），宽屏同样
 *    要能开。
 * 2. 补了焦点陷阱与焦点归还。ReaderTocDrawer 不做是因为它只在 <lg 出现，那里整页
 *    本来就是单列、抽屉背后没什么可 Tab 的；而这一份在 1440px 下也会铺满视口，
 *    Tab 走出去就是落在遮罩背后看不见的工具栏上（焦点环被遮罩盖住），键盘用户会
 *    直接迷路。既然声明了 aria-modal，就得真的把焦点关在里面。
 *
 * 必须 portal 到 document.body：详情页外层 `.stagger-in > *` 的进场动画以
 * fill-mode:both 把 transform 永久留在容器上，而带 transform 的祖先会成为 fixed
 * 元素的包含块；PDF 面板自身的 .paper-card 还带 backdrop-filter，同样会成为包含块。
 * 不 portal 的话面板会被「固定」在面板内部而不是贴视口左边。
 *
 * 纯 props 组件：不碰 pdfjs（PdfOutlineNode 是 type-only import）。
 */
export function PdfOutlineDrawer({
  open,
  onOpenChange,
  items,
  onJump,
}: PdfOutlineDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      // 焦点陷阱。面板 portal 在 body 末尾，什么都不做的话 Shift+Tab 一下就退到
      // 遮罩背后的页面里去了（而且焦点环被遮罩盖住，用户看不出焦点跑哪了）。
      // 面板内可聚焦的只有 <button> 与外链书签的 <a href>；遮罩那个按钮刻意带
      // tabIndex={-1}，且不在 panelRef 里，不进循环。
      // a[href] 这一支不能漏：querySelectorAll 按文档序返回，漏掉它会让「最后一个
      // 按钮」算错——落在尾部外链上的焦点一按 Tab 就直接跑出面板了。
      const panel = panelRef.current;
      if (!panel) {
        return;
      }
      const focusable = panel.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href]",
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const edge = event.shiftKey ? first : last;
      if (!panel.contains(active) || active === edge) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  // 打开时把焦点送到关闭按钮（面板 portal 到 body 后不在文档原本的 Tab 顺序附近，
  // 不送焦点键盘用户得摸黑 Tab 一遍才找到出口），关闭时再还回去。归还这一步在这里
  // 是必需的而不是锦上添花：点条目跳转会连带关掉抽屉，被点的那个按钮随即卸载，
  // 焦点掉回 <body>，此后 PageDown 不再翻 PDF、Tab 从整页头部重来。
  // 用 ref + 手动 focus() 而非 JSX 的 autoFocus，避开 biome 的 noAutofocus 规则。
  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) {
    return null;
  }

  const handleJump = (dest: unknown) => {
    // 先跳后关。goToDest 内部是 async（要 await getDestination），但它只依赖
    // usePdfViewer 里的 viewer 实例，与本组件是否还挂着无关，关抽屉打断不了它。
    onJump(dest);
    onOpenChange(false);
  };

  return createPortal(
    // overflow-hidden + overscroll-contain 是这层的滚动锁：遮罩自己不可滚，滚轮事件
    // 会顺着祖先链一路冒到 <html> 上，实测「开着抽屉在遮罩上滚一下，背后整页滚了
    // 350px」——抽屉是 fixed 的不动，用户关掉后阅读位置已经被挪走了。这一层带
    // overflow-hidden 就成了滚动容器（虽然没有可滚内容），overscroll-contain 让链
    // 停在这里。比 body overflow:hidden 那种做法干净：不碰全局样式，也没有隐藏
    // 滚动条带来的整页横向抖动。抽屉列表自己也带 overscroll-contain。
    <div className="fixed inset-0 z-[60] overflow-hidden overscroll-contain">
      {/* 遮罩用 <button> 只是为了拿到无障碍可用的点击语义（裸 div + onClick 会被
          biome 的 a11y 规则挡下）。tabIndex={-1}：它对键盘用户毫无价值——Esc 与
          右上角关闭按钮已经是出口，让它进 Tab 循环只会多出一个「看不见的按钮」。 */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        // touch-none：上面那层的 overflow-hidden+overscroll-contain 只挡得住滚轮与
        // 键盘。iOS Safari 的 rubber-band 会从「没有可滚溢出的滚动容器」里穿出去，
        // 而 portal 根正是这个形状；把遮罩上的触摸手势整个交给我们自己（它本来也
        // 只需要点击）是最省事的拦法。面板内的列表不受影响，自己能滚。
        // 注：本地无 iOS 设备，这条未经真机验证。
        className="absolute inset-0 touch-none bg-[rgba(20,18,15,0.42)] backdrop-blur-[2px] animate-in fade-in duration-200"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={panelRef}
        id={PDF_OUTLINE_PANEL_ID}
        role="dialog"
        aria-modal="true"
        aria-label={m.pdf_outline()}
        className="absolute inset-y-0 left-0 flex w-[min(82vw,22rem)] flex-col border-r border-[var(--line)] bg-[var(--parchment)] px-[0.85rem] py-4 shadow-[12px_0_40px_rgba(20,18,15,0.24)] animate-in slide-in-from-left duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
      >
        <div className="flex items-center justify-between px-[0.4rem] pb-3 pt-1">
          <span className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            {m.pdf_outline()}
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            className={cn(TOOL_BTN, ICON_BTN)}
            onClick={() => onOpenChange(false)}
            aria-label={m.pdf_outline_close()}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* overscroll-contain：列表滚到底后继续滚不会把背后的整页一起带着走 */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <OutlineLevel items={items} depth={0} onJump={handleJump} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * 递归渲染大纲树。缩进用 padding 而不是嵌套 margin：深层节点仍要能整行点击，
 * 嵌套 margin 会把可点区域一层层缩窄。深度超过 MAX_INDENT_DEPTH 就不再往里推——
 * 书签树的深度由文档作者决定（没有上限），375px 窄屏上线性加下去几层之后正文
 * 就只剩一列字了；到那个深度层次感已经由前几级表达完了。
 */
function OutlineLevel({
  items,
  depth,
  onJump,
}: {
  items: PdfOutlineNode[];
  depth: number;
  onJump: (dest: unknown) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item, index) => {
        // items 在 use-pdf-viewer 里是 as 断言出来的、没做运行时校验；pdf.js 每个
        // 节点都建了 items: []（core/catalog.js），但一次 render 里抛 TypeError 会
        // 把整个详情页炸成白屏，这个兜底比它防的风险便宜得多。
        const children = item.items ?? [];
        // 大纲条目也可以只带外链而没有 dest（PDF 规范里书签可以是 URI action）。
        // 那种节点交给 goToDest 只会在控制台留一条 "not a valid destination array"
        // 然后把抽屉关掉——看着像坏了；但它并非无处可去，pdf.js 会给它填 url。
        // 新标签页打开，与 use-pdf-viewer 里注解层的 externalLinkTarget: BLANK 一致：
        // 同标签页跳转会把整个 SPA 连同 chat 会话一起卸载掉。
        // url 也可能没有（既无 dest 又无 url 的坏书签），那种才真的只能渲染成死文本。
        const jumpable = item.dest != null;
        const url = (item as OutlineItemWithUrl).url;
        // 缺 /Title 时 pdf.js 给的是空串。空按钮既没有无障碍名称、又只有一条细缝
        // 可点，用占位符顶上。
        const label = item.title.trim() || "—";
        const indent = {
          paddingLeft: `${0.5 + Math.min(depth, MAX_INDENT_DEPTH) * 0.75}rem`,
        };
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: pdf.js 的大纲节点没有稳定 id，同级同名标题也确实存在；这棵树在文档生命周期内是常量（只在 setOutline 时整体替换），不存在插入/重排，下标是稳定的
          <li key={`${depth}-${index}`}>
            {jumpable ? (
              <button
                type="button"
                onClick={() => onJump(item.dest)}
                style={indent}
                className="w-full cursor-pointer rounded-md py-1.5 pr-2 text-left text-sm leading-snug break-words text-[var(--ink-soft)] transition-colors hover:bg-[var(--parchment-warm)] hover:text-[var(--ink)]"
                title={label}
              >
                {label}
              </button>
            ) : url ? (
              // TOOL_BTN 那条注释同款问题：styles.css 里裸的 `a { color: … }` 没进
              // @layer，压过工具类，不加 ! 这行会变成学术棕。
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={indent}
                className="block rounded-md py-1.5 pr-2 text-sm leading-snug break-words text-[var(--ink-soft)]! no-underline transition-colors hover:bg-[var(--parchment-warm)] hover:text-[var(--ink)]!"
                title={label}
              >
                {label}
              </a>
            ) : (
              <span
                style={indent}
                className="block py-1.5 pr-2 text-sm leading-snug break-words text-[var(--ink-soft)] opacity-70"
                title={label}
              >
                {label}
              </span>
            )}
            {children.length > 0 && (
              <OutlineLevel
                items={children}
                depth={depth + 1}
                onJump={onJump}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
