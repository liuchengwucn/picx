/**
 * quote-share 的测试夹具。抽成共享模块而不是各测试文件各抄一份：KATEX_ALPHA 必须是
 * rehype-katex 真实产出的形状（annotation 是 .katex-mathml 的兄弟、MathML 里那份纯
 * 文本与 annotation 不同形），抄错一处就会让「MathML 有没有泄漏」这件事测不出来。
 */

/**
 * 真实 KaTeX 产物的最小复刻：mathml 与 html 各含一份「α」，textContent 会拿到两份。
 */
export const KATEX_ALPHA =
  '<span class="katex">' +
  '<span class="katex-mathml"><math><semantics><mrow><mi>α</mi></mrow>' +
  '<annotation encoding="application/x-tex">\\alpha</annotation>' +
  "</semantics></math></span>" +
  '<span class="katex-html" aria-hidden="true">α</span>' +
  "</span>";

/** 把 html 挂进 body 里的 <article class="reader-prose">，返回那个 article */
export function mount(html: string): HTMLElement {
  document.body.innerHTML = `<article class="reader-prose">${html}</article>`;
  return document.querySelector("article") as HTMLElement;
}
