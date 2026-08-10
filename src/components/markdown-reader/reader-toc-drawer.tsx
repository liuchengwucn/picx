import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ICON_BTN, TOOL_BTN } from "#/components/reader/reader-ui";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { type TocItem, TocList } from "./reader-toc";

interface ReaderTocDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: TocItem[];
  activeId: string;
  onJump: (id: string) => void;
}

/**
 * 窄屏（<lg）目录抽屉：左滑面板 + 遮罩，样式与交互对齐 /reader 页的移动端目录抽屉
 * （src/components/reader/reader-view.tsx）——面板宽度、动画、配色全部照搬，额外补了
 * Esc 关闭（/reader 那份原本没有）；/reader 也没做 body 滚动锁定，这里保持一致不加。
 *
 * 必须 portal 到 document.body：论文详情页外层 `.stagger-in > *` 的进场动画用
 * `animation-fill-mode: both`，动画结束后仍把 `transform` 留在容器上，而带 transform
 * 的祖先会成为 fixed 元素的包含块——不 portal 的话面板会被那层 transform「固定」在
 * 内容位置而不是贴视口左边（paper-chat.tsx 的聊天 FAB 同一个坑）。只在 open 时挂载，
 * SSR 首帧不会触发（抽屉本来就要点开才 open）。
 */
export function ReaderTocDrawer({
  open,
  onOpenChange,
  items,
  activeId,
  onJump,
}: ReaderTocDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  // 面板 portal 到 body 后不在文档原本的 Tab 顺序附近：把焦点送到这个可见的关闭
  // 按钮上，键盘用户打开抽屉后不必先摸黑 Tab 一遍才找到出口。用 ref + 手动 focus()
  // 而非 JSX 的 autoFocus 属性，避开 biome 的 noAutofocus 规则（对这个场景是误报，
  // 但规则本身不区分「模态浮层理应移交焦点」和「普通表单元素别抢焦点」两种情况）。
  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const handleJump = (id: string) => {
    onJump(id);
    onOpenChange(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] lg:hidden">
      <button
        type="button"
        aria-label={m.reader_toc_close()}
        className="absolute inset-0 bg-[rgba(20,18,15,0.42)] backdrop-blur-[2px] animate-in fade-in duration-200"
        onClick={() => onOpenChange(false)}
      />
      <div className="absolute inset-y-0 left-0 flex w-[min(82vw,20rem)] flex-col border-r border-[var(--line)] bg-[var(--parchment)] px-[0.85rem] py-4 shadow-[12px_0_40px_rgba(20,18,15,0.24)] animate-in slide-in-from-left duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)]">
        <div className="flex items-center justify-between px-[0.4rem] pb-3 pt-1">
          <span className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            {m.reader_toc()}
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            className={cn(TOOL_BTN, ICON_BTN)}
            onClick={() => onOpenChange(false)}
            aria-label={m.reader_toc_close()}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <TocList items={items} activeId={activeId} onJump={handleJump} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
