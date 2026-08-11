import { FileText, Loader2, MessageSquareQuote } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SelectionActionBubble } from "#/components/selection/selection-action-bubble";
import { Button } from "#/components/ui/button";
import { useSelectionRect } from "#/hooks/use-selection-rect";
import { m } from "#/paraglide/messages";
import { PdfFindBar } from "./pdf-find-bar";
import { PdfOutlineDrawer } from "./pdf-outline-drawer";
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
  /** 用户点「问这段」时把选中文本交出去；页面层负责送进 chat */
  onAskSelection: (text: string) => void;
}

export default function PdfReaderView({
  url,
  title,
  initialPage,
  onPageChange,
  onAskSelection,
}: PdfReaderViewProps) {
  const pdf = usePdfViewer(url, initialPage);
  // 根节点取滚动容器而不是里面那个 .pdfViewer：两者嵌套，对 intersectsNode 判定
  // 等价，但容器是唯一一个「一定存在、且生命周期与本组件一致」的节点——.pdfViewer
  // 里的每个 textLayer 都会随虚拟化反复增删。
  const selection = useSelectionRect(pdf.containerRef);
  // 下载文件名要显式给：url 是 /api/r2/<key>，不给的话浏览器会拿那串 R2 key 当
  // 文件名。工具栏与出错遮罩两处入口共用同一份。
  const downloadName = `${title}.pdf`;

  // 页码上报给页面层，切 tab 回来能恢复。onPageChange 必须是稳定引用，否则每次
  // 渲染都会重跑这个 effect（页面层用 useCallback 保证）。
  useEffect(() => {
    onPageChange(pdf.pageNumber);
  }, [pdf.pageNumber, onPageChange]);

  // 大纲抽屉与搜索条的开关。
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);

  // 收起搜索条必须连高亮一起清掉，否则满屏的黄底会一直留在正文上，而此时已经没有
  // 任何入口能取消它了。收起有三条路——搜索条的关闭按钮、Esc、以及再点一次工具栏的
  // 搜索按钮——所以清理挂在开关本身上，而不是挂在搜索条的 onClose 上。
  // clearFind 是 useCallback 稳定引用，这里跟着稳定，搜索条那边的 debounce effect
  // 才不会每渲染一次就重排一次。
  const { clearFind } = pdf;
  const handleFindOpenChange = useCallback(
    (open: boolean) => {
      if (!open) clearFind();
      setFindOpen(open);
    },
    [clearFind],
  );

  return (
    <div className="paper-card relative flex h-[70dvh] flex-col overflow-hidden p-0 xl:sticky xl:top-24 xl:h-[calc(100dvh-8rem)]">
      <PdfToolbar
        title={title}
        downloadUrl={url}
        downloadName={downloadName}
        ready={pdf.status === "ready"}
        pageNumber={pdf.pageNumber}
        pageCount={pdf.pageCount}
        scale={pdf.scale}
        hasOutline={pdf.outline.length > 0}
        outlineOpen={outlineOpen}
        onOutlineOpenChange={setOutlineOpen}
        findOpen={findOpen}
        onFindOpenChange={handleFindOpenChange}
        onGoToPage={pdf.goToPage}
        onZoomIn={pdf.zoomIn}
        onZoomOut={pdf.zoomOut}
        onFitWidth={pdf.fitWidth}
      />
      {/* 搜索条钉在工具栏下方、参与 flex 布局：它只压矮滚动区不改宽度，而 usePdfViewer
          的 ResizeObserver 有宽度守卫，纯高度变化会被它 early-return 掉，因此开合搜索条
          不会重算「适宽」倍率（重新赋 currentScaleValue 哪怕倍率没变也会先跑一次
          clearSelection()，见那边的注释）。
          但选区照样保不住：搜索条一挂载就要聚焦自己的输入框，而 Chromium 里聚焦任何
          input 都会清空文档选区（单点一下工具栏的页码框同样会清）。也就是说这里清选区
          的是焦点、不是 resize——Task 7 的选中气泡排查「选区莫名消失」时别找错方向。 */}
      {findOpen && (
        <PdfFindBar
          matchIndex={pdf.findMatchIndex}
          matchCount={pdf.findMatchCount}
          notFound={pdf.findNotFound}
          onSearch={pdf.find}
          onAgain={pdf.findAgain}
          onClose={() => handleFindOpenChange(false)}
        />
      )}
      {/* 这层只负责给下面那个绝对定位的滚动容器撑出可用区域并做定位参照。
          PDFViewer 构造时会直接读 getComputedStyle(container).position，不是
          "absolute" 就抛 "The `container` must be absolutely positioned."——
          所以滚动容器没得选，尺寸只能由外面这层的 flex-1 决定。 */}
      <div className="relative min-h-0 flex-1">
        {/* 滚动容器：PDFViewer 的虚拟化直接监听这个元素的 scroll 事件。
            它必须铺满面板，不能限宽。「chat 收起时是单列、PDF 会被拉到 1520px 宽」
            这个问题是真的，但限宽要加在**倍率**上（见 use-pdf-viewer 的
            FIT_WIDTH_MAX_PAGE_WIDTH），不能加在这里：容器一限宽，可视区域就跟着
            被钉死在 1200px，放大到 200% 时页面 1385px 只能在 1185px 的窗口里横向
            滚动，而两侧各 159px 的面板是空的——放大反而看得更少。 */}
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
          className="absolute inset-0 overflow-auto bg-[var(--parchment-warm)]"
        >
          <div ref={pdf.viewerRef} className="pdfViewer" />
        </div>

        {/* 遮罩只盖滚动区、不盖工具栏：9.4MB 的 PDF 在慢网下是十几秒空白转圈，盖住
            工具栏就等于用户既看不到自己点开的是哪篇论文，也拿不到「等不及就直接下载」
            这个逃生口——而下载入口正好就在被盖住的那 40px 里。出错态同理。
            放在这一层是安全的：它本来就是 relative，遮罩是绝对定位浮层，不参与滚动
            容器的定位与 clientWidth 计算，PDFViewer 对 container 的校验不受影响。
            注意它只挡视觉与指针、不挡焦点，所以工具栏必须靠 ready 自己置灰。

            遮罩里刻意不用 PaperStateCard：它的根类 .paper-card 是无 layer 的裸类，
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
                    <a href={url} download={downloadName}>
                      {m.paper_download_pdf()}
                    </a>
                  </Button>
                </div>
              </>
            )}
          </output>
        )}
      </div>

      {/* 抽屉自己 portal 到 body，挂在这里只是为了跟工具栏共用同一处开关状态；
          它不参与本面板的布局，也不受 overflow-hidden 影响。 */}
      <PdfOutlineDrawer
        open={outlineOpen}
        onOpenChange={setOutlineOpen}
        items={pdf.outline}
        onJump={pdf.goToDest}
      />

      {/* SSR 安全：selection.state 初始为 null，只在 useSelectionRect 的 effect 里
          挂上的监听器中才会变成非 null，服务端与客户端首帧都走不到这里。 */}
      {selection.state && (
        <SelectionActionBubble
          rect={selection.state.rect}
          // 交 ref 而不是算好的坐标：气泡要在 layout 阶段跟自身尺寸一起量，
          // 在这里读就成了 render 期读 ref + 每 rAF 一次多余的强制布局。
          boundaryRef={pdf.containerRef}
          actions={[
            {
              key: "ask",
              icon: MessageSquareQuote,
              label: m.selection_ask(),
              onClick: () => {
                // state 在下一句就被清掉，先取出文本
                const text = selection.state?.text ?? "";
                selection.dismiss();
                // 只 dismiss 不清 DOM 选区的话，紧接着任何一次滚动都会重新 evaluate
                // 出同一个选区，气泡自己又冒回来。
                document.getSelection()?.removeAllRanges();
                if (text) onAskSelection(text);
              },
            },
          ]}
        />
      )}
    </div>
  );
}
