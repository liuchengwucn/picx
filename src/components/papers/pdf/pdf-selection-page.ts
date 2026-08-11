/**
 * 选区落在 PDF 的哪一页。
 *
 * 取选区**起点**所在的页面容器（pdf.js 在每个页面容器上写了 data-page-number），而不是
 * 阅读器的「当前页」：一页在 100% 倍率下比视口高，滚到页面下半时 pageNumber 已经翻到
 * 下一页，拿它当引文页码会偏一页。
 *
 * 起点可能压根不在任何页面容器里（Ctrl+A 让端点落到 root 的祖先上，从面板外往里拖同
 * 理），此时退回调用方给的当前页。
 *
 * 这是第四处**依赖 pdfjs 内部 DOM 结构**的地方，针对 **pdfjs-dist 6.2.108** 验证过
 * （`pdf_viewer.mjs` 里 `PDFPageView` 构造时写死 `div.className = "page"` 紧跟
 * `div.setAttribute("data-page-number", this.id)`）。另外三处在 styles.css 的 pdfjs
 * 主题段里，升 pdfjs 时请连同那份清单一起复查——这里失效不会报错，只会让页码安静地
 * 恒等于「当前页」。
 *
 * 用 [data-page-number] 而不是 .page 定位：只依赖一个事实而不是两个耦合的事实，而且
 * `.page` 作为类名在应用 DOM 里往上 closest() 实在太通用。
 */
export function pageNumberOfSelection(range: Range, fallback: number): number {
  const node = range.startContainer;
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  const raw = el
    ?.closest?.("[data-page-number]")
    ?.getAttribute("data-page-number");
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
