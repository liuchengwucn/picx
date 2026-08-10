import { FileText, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { m } from "#/paraglide/messages";
import { PdfToolbar } from "./pdf-toolbar";
import { usePdfViewer } from "./use-pdf-viewer";
// 官方 viewer 的样式表。它是非 Tailwind 的全局样式，但全部以 .pdfViewer / .textLayer
// 前缀自限作用域；主题对齐只覆盖它的 CSS 变量（见 styles.css），不重写规则。
// 静态 import 放在这里而不是路由里，是为了让它跟着本组件的 lazy chunk 一起走：
// 客户端构建把它单独产出成 pdf-reader-view-*.css，由 __vitePreload 在动态 import
// 本组件时才插 <link>。SSR 侧这条 import 被 stub-pdfjs-ssr 换成空模块（见
// vite.config.ts）——客户端构建是另一张依赖图，样式不受影响。
import "pdfjs-dist/web/pdf_viewer.css";

export interface PdfReaderViewProps {
  /** PDF 的可取地址（/api/r2/<pdfR2Key>） */
  url: string;
  title: string;
  /** 切 tab 回来时恢复到的页码 */
  initialPage: number;
  onPageChange: (page: number) => void;
}

export default function PdfReaderView({
  url,
  title,
  initialPage,
  onPageChange,
}: PdfReaderViewProps) {
  const pdf = usePdfViewer(url, initialPage);

  // 页码上报给页面层，切 tab 回来能恢复。onPageChange 必须是稳定引用，否则每次
  // 渲染都会重跑这个 effect（页面层用 useCallback 保证）。
  useEffect(() => {
    onPageChange(pdf.pageNumber);
  }, [pdf.pageNumber, onPageChange]);

  // 大纲抽屉与搜索条的开关。实体组件分别在 Task 5 / Task 6 接进来，这里先只管
  // 工具栏按钮的开关语义。
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  void outlineOpen;
  void findOpen;

  return (
    <div className="paper-card relative flex h-[70dvh] flex-col overflow-hidden p-0 xl:sticky xl:top-24 xl:h-[calc(100dvh-8rem)]">
      <PdfToolbar
        title={title}
        downloadUrl={url}
        downloadName={`${title}.pdf`}
        pageNumber={pdf.pageNumber}
        pageCount={pdf.pageCount}
        scale={pdf.scale}
        hasOutline={pdf.outline.length > 0}
        onOpenOutline={() => setOutlineOpen(true)}
        onToggleFind={() => setFindOpen((open) => !open)}
        onGoToPage={pdf.goToPage}
        onZoomIn={pdf.zoomIn}
        onZoomOut={pdf.zoomOut}
        onFitWidth={pdf.fitWidth}
      />
      {/* 这层只负责给下面那个绝对定位的滚动容器撑出可用区域并做定位参照。
          PDFViewer 构造时会直接读 getComputedStyle(container).position，不是
          "absolute" 就抛 "The `container` must be absolutely positioned."——
          所以滚动容器没得选，尺寸只能由外面这层的 flex-1 决定。 */}
      <div className="relative min-h-0 flex-1">
        {/* 滚动容器：PDFViewer 的虚拟化直接监听这个元素的 scroll 事件，并按它的
            clientWidth 算「适宽」倍率。
            限宽也必须加在这个元素上：chat 收起时栅格是单列，不限宽的话 PDF 会被
            拉到整个 1520px 容器宽，约等于两倍舒适阅读宽度。绝不能改成「容器不限宽、
            内层再套一个 max-w wrapper」——那样倍率仍按未限宽的容器算，页面会比可用
            宽度还宽然后被裁掉。绝对定位下没有 mx-auto，居中靠 left-1/2 + 位移。 */}
        {/* tabIndex/aria-label 不能省：滚动容器里全是 canvas，没有可聚焦内容，
            纯键盘用户能否用 PageDown 翻页只能仰仗各浏览器「可滚动区域自动可聚焦」
            的启发式，而那个启发式各家不一致。显式声明成有名字的可聚焦区域。 */}
        {/* biome-ignore lint/a11y/useSemanticElements: 换不成 <section>——PDFViewer 构造时校验 container.tagName === "DIV"，不是 div 直接抛 "Invalid `container` and/or `viewer` option." */}
        <div
          ref={pdf.containerRef}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: 这是可滚动区域，进焦点序列正是为了让键盘能翻页；注解层里的 <a> 会让浏览器「可滚动区自动可聚焦」的启发式失效，必须显式声明
          tabIndex={0}
          role="region"
          aria-label={title}
          className="absolute inset-y-0 left-1/2 w-full max-w-[1200px] -translate-x-1/2 overflow-auto bg-[var(--parchment-warm)]"
        >
          <div ref={pdf.viewerRef} className="pdfViewer" />
        </div>
      </div>

      {/* 遮罩里刻意不用 PaperStateCard：它的根类 .paper-card 是无 layer 的裸类，
          按 CSS 层叠顺序胜过 @layer utilities 里的所有 Tailwind 工具类，
          传 className 去掉它的底板/描边是覆盖不掉的（见 styles.css 的同款注释）。
          这里本来就要「贴在 PDF 面板内的浮层」而不是「一张卡片套一张卡片」。 */}
      {pdf.status !== "ready" && (
        // 用 <output> 而不是 div + role="status"：它自带 role=status 与
        // aria-live=polite，加载/出错文案会被读屏播报，而 div 默认什么都不播。
        <output className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--parchment)] px-6 text-center">
          {pdf.status === "loading" ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-[var(--academic-brown)]" />
              <p className="text-sm text-[var(--ink-soft)]">
                {m.pdf_loading()}
              </p>
            </>
          ) : (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--parchment-warm)]">
                <FileText className="h-6 w-6 text-[var(--academic-brown)]" />
              </div>
              <p className="max-w-sm text-sm text-[var(--sienna)]">
                {pdf.errorKind === "password"
                  ? m.pdf_encrypted()
                  : pdf.errorKind === "engine"
                    ? m.pdf_engine_failed()
                    : m.pdf_load_failed()}
              </p>
              <div className="flex gap-2">
                {pdf.errorKind !== "password" && (
                  <Button variant="outline" size="sm" onClick={pdf.reload}>
                    {m.pdf_retry()}
                  </Button>
                )}
                <Button variant="outline" size="sm" asChild>
                  <a href={url} download>
                    {m.paper_download_pdf()}
                  </a>
                </Button>
              </div>
            </>
          )}
        </output>
      )}
    </div>
  );
}
