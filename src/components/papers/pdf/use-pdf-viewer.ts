import type { PDFDocumentProxy } from "pdfjs-dist";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * pdf.js 官方 viewer 组件（`pdfjs-dist/web/pdf_viewer.mjs`）的 React 封装。
 *
 * 全项目只有这个文件 import pdfjs：官方 viewer 是 EventBus + 手动 setDocument +
 * 手动 destroy 的命令式 API，散在组件里会很难维护。对外只暴露不可变状态与命令，
 * 调用方不需要知道 pdfjs 的存在。
 *
 * 引擎经 await import() 加载：pdf.mjs 约 350KB(gz)，绝不能进主 chunk。本文件只被
 * pdf-reader-view.tsx 引用，而后者只经 React.lazy 加载，所以它进不了客户端主 chunk。
 *
 * 但 import() 只决定「什么时候执行」，不决定「打不打包」：下面几个 import() 的
 * 说明符都是字面量，rollup 在构建期就会跟进去，把 pdfjs 整条子树同时纳入客户端图
 * 和 SSR 图。服务端从不执行它们（都在 effect 里），可字节照样进 Worker 包——
 * 一度 +604 KiB gzip。真正把它拦在 SSR 外面的是 vite.config.ts 里的 stub-pdfjs-ssr
 * 插件，改动这里的 import 形式前先去看那段注释。
 */

export type PdfStatus = "loading" | "ready" | "error";
/** engine=引擎 chunk 拉不下来；document=PDF 本身取不到或损坏；password=加密 PDF */
export type PdfErrorKind = "engine" | "document" | "password";

export interface PdfOutlineNode {
  title: string;
  dest: unknown;
  items: PdfOutlineNode[];
}

export interface PdfViewerApi {
  /** 挂到定高滚动容器上（必须 position:absolute/relative + overflow:auto） */
  containerRef: RefObject<HTMLDivElement | null>;
  /** 挂到容器内那个 class="pdfViewer" 的 div 上 */
  viewerRef: RefObject<HTMLDivElement | null>;
  status: PdfStatus;
  errorKind: PdfErrorKind | null;
  pageNumber: number;
  pageCount: number;
  scale: number;
  outline: PdfOutlineNode[];
  findMatchIndex: number;
  findMatchCount: number;
  findNotFound: boolean;
  goToPage: (page: number) => void;
  goToDest: (dest: unknown) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitWidth: () => void;
  find: (query: string) => void;
  findAgain: (previous: boolean) => void;
  clearFind: () => void;
  /** 出错后重试：bump 一个内部 epoch，重新走整条加载流程 */
  reload: () => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const SCALE_STEP = 1.1;
/**
 * 「适宽」的哨兵值。它不再被交给 pdfjs（见 applyFitWidth），只作为 scaleValueRef 里
 * 「这是一个持续意图、容器变宽要重算」的标记；数字倍率则由用户说了算。
 */
const FIT_WIDTH = "page-width";

/**
 * 「适宽」时页面宽度的上限。
 *
 * 这个上限**只能加在倍率上，不能加在滚动容器上**。容器限宽是最直觉的写法（一行
 * max-w 就完事，还自带居中），但它把「舒适阅读宽度」和「可视区域」焊成了一件事：
 * 面板 1520px 时容器只有 1200px，放大到 200% 后页面 1385px 宽，只能挤在 1185px 的
 * 窗口里横向滚动，而两侧各 159px 的面板是空的——用户放大是为了看清，结果可视面积
 * 反而比面板小了一圈。
 *
 * 所以容器铺满面板，改由这里限制适宽倍率：适宽时页面仍是 1200px 的舒适宽度并居中
 * （.page 的 margin:auto 负责），一旦放大超过容器就把整个面板宽度都用上。
 */
const FIT_WIDTH_MAX_PAGE_WIDTH = 1200;
/**
 * pdfjs 在 #setScale 里算「适宽」时从 container.clientWidth 扣掉的横向留白，
 * 为纵向滚动条预留。这里自己算倍率，就得原样照抄这个常量，否则适宽会比官方宽 40px
 * 并稳定地压出一条横向滚动条。数值取自 pdf_viewer.mjs 的 SCROLLBAR_PADDING。
 */
const SCROLLBAR_PADDING = 40;

type ViewerModule = typeof import("pdfjs-dist/web/pdf_viewer.mjs");

interface ViewerBundle {
  viewer: InstanceType<ViewerModule["PDFViewer"]>;
  linkService: InstanceType<ViewerModule["PDFLinkService"]>;
  eventBus: InstanceType<ViewerModule["EventBus"]>;
}

/**
 * `setDocument(null)` 是官方的销毁入口（它会取消所有 pending 渲染并 reset 视图），
 * 但生成出来的 .d.ts 把参数标成了非空的 PDFDocumentProxy。这里只补类型不改行为。
 */
const NO_DOCUMENT = null as unknown as PDFDocumentProxy;

/**
 * 套用「适宽」。
 *
 * 不能直接 `currentScaleValue = "page-width"`：那条路径按 container.clientWidth 铺满
 * 整个容器，而容器现在铺满整个面板（原因见 FIT_WIDTH_MAX_PAGE_WIDTH）。这里照抄
 * pdfjs #setScale 里的公式，只把容器宽度先收到上限之内：
 *
 *   scale = (min(clientWidth, 上限) - SCROLLBAR_PADDING) / 当前页当前宽度 * 当前页倍率
 *
 * 公式里必须用「当前页」而不是第一页：pdfjs 自己就是这么取的（`_pages[currentPageNumber-1]`），
 * 论文里横向的表格页、跨栏插图页跟正文页尺寸不同，按第一页算会让翻到那些页时宽度突变。
 *
 * getPageView 在 pagesinit 之前返回 undefined。那时候交还给 pdfjs 的关键字路径——
 * 它内部对「拿不到当前页」有 early return，行为是「什么都不做」，等 pagesinit 之后
 * 我们会被再调一次；而这里若不判空，unscaled 会算出 NaN 并把 currentScale 设成 NaN。
 */
function applyFitWidth(
  viewer: InstanceType<ViewerModule["PDFViewer"]>,
  container: HTMLElement,
): void {
  const page = viewer.getPageView(viewer.currentPageNumber - 1) as
    | { width: number; scale: number }
    | undefined;
  if (!page?.width || !page.scale) {
    viewer.currentScaleValue = FIT_WIDTH;
    return;
  }
  const usable =
    Math.min(container.clientWidth, FIT_WIDTH_MAX_PAGE_WIDTH) -
    SCROLLBAR_PADDING;
  const next = (usable / page.width) * page.scale;
  // 极窄容器（窄屏 + 抽屉动画中间态）会把 usable 算成 0 甚至负数，MIN_SCALE 兜住；
  // 上限跟着手动缩放走，免得适宽能到达一个按钮点不到的倍率。
  viewer.currentScale = Math.min(Math.max(next, MIN_SCALE), MAX_SCALE);
}

export function usePdfViewer(url: string, initialPage: number): PdfViewerApi {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const bundleRef = useRef<ViewerBundle | null>(null);
  /** 「适宽」是一个持续意图而不是一次性动作：容器宽度变了要重新套用 */
  const scaleValueRef = useRef<string>(FIT_WIDTH);
  // 刻意只取首次挂载时的值：切 tab 是整个组件卸载重挂，恢复页码走的是新的一次
  // 挂载。因此 initialPage 后续变化不会被这个 ref 跟上——这是「初始页」的语义，
  // 不是疏漏。（reload() 原地重跑时它会把视图带回初始页，而不是当前页。）
  const initialPageRef = useRef(initialPage);
  /** findAgain 要把原查询词原样带回去，见 findAgain 里的注释 */
  const queryRef = useRef("");
  const [epoch, setEpoch] = useState(0);

  const [status, setStatus] = useState<PdfStatus>("loading");
  const [errorKind, setErrorKind] = useState<PdfErrorKind | null>(null);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1);
  const [outline, setOutline] = useState<PdfOutlineNode[]>([]);
  const [findMatchIndex, setFindMatchIndex] = useState(0);
  const [findMatchCount, setFindMatchCount] = useState(0);
  const [findNotFound, setFindNotFound] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch 只用于驱动重跑（reload 时整条加载流程要重来），本身不在闭包里读取
  useEffect(() => {
    let cancelled = false;
    let bundle: ViewerBundle | null = null;
    let loadingTask: ReturnType<
      typeof import("pdfjs-dist").getDocument
    > | null = null;

    async function boot() {
      // 每一份文档派生状态都要在这里归零，一条都不能漏：reload() 是原地重跑，
      // 残留的 pageCount / outline / 命中计数会挂在新文档上显示，而 find* 三个
      // 除了 clearFind() 之外没有别的复位路径。
      setStatus("loading");
      setErrorKind(null);
      setPageCount(0);
      setOutline([]);
      setFindMatchIndex(0);
      setFindMatchCount(0);
      setFindNotFound(false);

      let pdfjs: typeof import("pdfjs-dist");
      let viewerMod: ViewerModule;
      try {
        // worker 用 ?url 导入：Vite 会把它作为独立资源产出，并给出打包后的最终 URL。
        const [core, workerUrl] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        ]);
        // 关键是这两个 import 的**顺序**，不能并行。官方 viewer 组件不 import 核心库，
        // 而是在模块求值的第一行就从 globalThis.pdfjsLib 上把整套 API 解构下来
        // （见 pdfjs-dist/web/pdfjs.js）；这个全局由 pdfjs-dist 主入口在自己求值时
        // 写入（build/pdf.mjs 末尾的 `globalThis.pdfjsLib = {...}`）。所以必须先
        // await 到核心、让它完成求值，再 import viewer，否则一进来就是
        // "Cannot destructure property 'AbortException' of undefined"。
        // 我们自己不需要给这个全局赋值——写这行只是重复主入口已经做过的事。
        const web = await import("pdfjs-dist/web/pdf_viewer.mjs");
        pdfjs = core;
        viewerMod = web;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
      } catch {
        if (!cancelled) {
          setStatus("error");
          setErrorKind("engine");
        }
        return;
      }

      if (cancelled) return;
      const container = containerRef.current;
      const viewerEl = viewerRef.current;
      if (!container || !viewerEl) {
        // 两个 ref 都在同一次提交里挂上，正常不可能取不到。真取不到就说明布局被
        // 改坏了——报错总比留一个永远转下去、还没有重试入口的 spinner 强。
        setStatus("error");
        setErrorKind("engine");
        return;
      }

      const eventBus = new viewerMod.EventBus();
      // 不指定 externalLinkTarget 的话它是 null，会穿过 addLinkAttributes 里所有
      // switch 分支，最终 link.target=""，即同标签页跳转。参考文献里的 DOI 链接
      // 一点就把整个 SPA 卸载掉，chat 会话和阅读位置一起没。
      const linkService = new viewerMod.PDFLinkService({
        eventBus,
        externalLinkTarget: viewerMod.LinkTarget.BLANK,
      });
      const findController = new viewerMod.PDFFindController({
        eventBus,
        linkService,
      });
      // 刻意不传 l10n：PDFViewer 自己会 `new GenericL10n()`（不带 lang），走的是
      // 内联兜底词条那条路，一次网络请求都不发；反过来显式传 `new GenericL10n(lang)`
      // 会去查 `link[type=application/l10n]` 并按它 fetch 语言包，还会顺带跳过官方
      // 对容器的 translate()（页面地标的 aria-label 就没人翻了）。
      const viewer = new viewerMod.PDFViewer({
        container,
        viewer: viewerEl,
        eventBus,
        linkService,
        findController,
      });
      linkService.setViewer(viewer);

      eventBus.on("pagesinit", () => {
        // 首帧同样不能走关键字路径，否则第一眼看到的就是铺满整个面板的页面，
        // 用户手动点一次「适宽」反而会变窄——两条路径必须给出同一个宽度。
        if (scaleValueRef.current === FIT_WIDTH) {
          applyFitWidth(viewer, container);
        } else {
          viewer.currentScaleValue = scaleValueRef.current;
        }
        // 钳到总页数：种子可能来自手改的 ?page= 或指向旧版本的旧链接。越界时
        // pdf.js 的 setter 只 console.error、把 _currentPageNumber 留在 1、且**不**派发
        // pagechanging，于是 React 那边的 pageNumber 会卡在那个荒谬的种子上（初值就是
        // initialPage），工具栏显示「99999 / 12」而阅读器停在第 1 页。
        const target = Math.min(initialPageRef.current, viewer.pagesCount);
        if (target > 1) {
          viewer.currentPageNumber = target;
        } else {
          // 钳到了 1（单页文档 + 越界种子）：上面那条赋值不会发生，也就没有
          // pagechanging 把 state 拨回来，得自己同步掉那个坏种子。
          setPageNumber(target);
        }
      });
      eventBus.on("pagechanging", (event: { pageNumber: number }) => {
        setPageNumber(event.pageNumber);
      });
      eventBus.on("scalechanging", (event: { scale: number }) => {
        setScale(event.scale);
      });
      eventBus.on(
        "updatefindmatchescount",
        (event: { matchesCount: { current: number; total: number } }) => {
          setFindMatchIndex(event.matchesCount.current);
          setFindMatchCount(event.matchesCount.total);
        },
      );
      eventBus.on(
        "updatefindcontrolstate",
        (event: {
          state: number;
          matchesCount: { current: number; total: number };
        }) => {
          setFindNotFound(event.state === viewerMod.FindState.NOT_FOUND);
          setFindMatchIndex(event.matchesCount.current);
          setFindMatchCount(event.matchesCount.total);
        },
      );

      bundle = { viewer, linkService, eventBus };
      bundleRef.current = bundle;

      // pdfjs 不把这些资源打进 bundle，运行时按 `${基址}${文件名}` 拼 URL 去 fetch。
      // 前三个基址少一个就抛 "Ensure that the `cMapUrl` API parameter is provided."，
      // 而这条异常发生在渲染单页的过程中，loadingTask 早就 resolve 了，status 会一直
      // 停在 "ready"，用户只看到一片空白正文，得不到任何解释。中日文 PDF（非嵌入 CID
      // 字体）走 cmaps，未嵌字体的文档走 standard_fonts，扫描件里的 JBIG2/JPEG2000
      // 走 wasm——对一个接受任意上传、面向中日文读者的站点都不是边缘情况。
      // iccUrl 是唯一的例外：缺了只 warn("No CMYK ICC profile support due to missing
      // `iccUrl` API option") 并优雅降级，排查 CMYK 显色问题时别往 throw 的方向找。
      // 资源由 postinstall 与 build 两处拷进 public/pdfjs/（见
      // scripts/copy-pdfjs-assets.mjs），在 Cloudflare 上作为 Static Assets 提供，
      // 不占 Worker 脚本体积。
      // 尾斜杠是硬性要求：getFactoryUrlProp() 对不以 "/" 结尾的值直接 throw。
      // 这四个是根相对路径，今天成立是因为站点部署在域名根、没有配 vite base。
      // 一旦改成子路径部署，它们必须跟着 BASE_URL 走——pdfjs 内部会拿
      // isValidFetchUrl(cMapUrl, document.baseURI) 判定，届时这些路径会解析到
      // 域名根然后全部 404。
      loadingTask = pdfjs.getDocument({
        url,
        cMapUrl: "/pdfjs/cmaps/",
        // 发布的 cmaps 是 .bcmap 二进制格式。当前版本这已是默认值，写出来是因为
        // 一旦它为 false，worker 会去请求不带扩展名的路径，全部 404。
        cMapPacked: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        wasmUrl: "/pdfjs/wasm/",
        iccUrl: "/pdfjs/iccs/",
      });
      let pdf: PDFDocumentProxy;
      try {
        pdf = await loadingTask.promise;
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setErrorKind(
          error instanceof pdfjs.PasswordException ? "password" : "document",
        );
        return;
      }
      if (cancelled) return;

      // linkService 先于 viewer 拿到 document：PDFFindController 读的是
      // linkService.pagesCount，而 viewer.setDocument 会同步派发首批事件。
      linkService.setDocument(pdf, null);
      viewer.setDocument(pdf);
      setPageCount(pdf.numPages);
      setStatus("ready");

      // 大纲单独兜错，不能并进上面那个 catch：PDF 已经渲染出来了，书签读不出来
      // 顶多是抽屉里空一块，不该把整个视图打回错误态。没有书签时官方运行时返回
      // null（.d.ts 漏标了这一支）。
      const raw = (await pdf.getOutline().catch((error: unknown) => {
        console.warn("PDF outline unavailable:", error);
        return null;
      })) as PdfOutlineNode[] | null;
      if (!cancelled) setOutline(raw ?? []);
    }

    // boot 里 import 之外还有会抛的同步代码（最典型的是 PDFViewer 对容器定位方式
    // 的断言）。不接这一手就只剩一个永远转下去的 spinner，连报错都看不见。
    void boot().catch((error: unknown) => {
      console.error("PDF viewer setup failed:", error);
      if (cancelled) return;
      setStatus("error");
      setErrorKind("engine");
    });

    return () => {
      cancelled = true;
      // 顺序不能反：先让 viewer 取消所有 pending 渲染、松开对 document 的引用，
      // 再销毁 loadingTask。loadingTask.destroy() 会连带终止 worker 线程——漏掉它
      // 就等于每次换 url / 点重试都泄漏一个 worker。
      bundle?.viewer.setDocument(NO_DOCUMENT);
      bundle?.linkService.setDocument(NO_DOCUMENT, null);
      // destroy() 会 reject 掉还没落地的 loadingTask.promise 等一串内部 promise，
      // 自己也可能 reject；不接住就是一条 unhandled rejection。
      loadingTask?.destroy().catch((error: unknown) => {
        console.warn("PDF loading task teardown failed:", error);
      });
      bundleRef.current = null;
    };
  }, [url, epoch]);

  // 官方 viewer 只监听 window.resize 重新套用缩放。本页拖宽 chat 栏、收起 chat 栏
  // 都只改容器宽度、不触发 window resize——不补这个观察器，「适宽」在拖完之后就废了。
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    // 必须自己比对宽度：重新赋 currentScaleValue 会走进 #setScaleUpdatePages，
    // 而它在判「倍率没变、直接返回」之**前**就调了 clearSelection()。也就是说
    // 一次空操作的重新赋值照样会清掉用户的选区。而本面板是 h-[70dvh]：移动端滚动
    // 时地址栏收起、软键盘开合、滚动条出现，都会只改高度触发 observer——不拦住，
    // 选中文字会莫名其妙地自己消失（Task 7 的选中气泡首当其冲）。
    let lastWidth = container.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      const viewer = bundleRef.current?.viewer;
      // 只有「适宽」这类关键字缩放需要跟着容器走；用户手动设过倍率就别乱动
      if (viewer && scaleValueRef.current === FIT_WIDTH) {
        applyFitWidth(viewer, container);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const goToPage = useCallback((page: number) => {
    // currentPageNumber 的 setter 对非整数直接 throw（越界只 console.error）。
    // 这是 Task 4 工具栏输入框与 Task 5 大纲共用的地基，别让它把调用方炸掉。
    if (!Number.isInteger(page)) return;
    const viewer = bundleRef.current?.viewer;
    if (viewer) viewer.currentPageNumber = page;
  }, []);

  const goToDest = useCallback((dest: unknown) => {
    // dest 是 getOutline() 原样吐出来的书签目标（命名目标字符串或显式目标数组），
    // 对外保持 unknown 是为了不把 pdfjs 的类型泄漏进调用方；这里再交还给 pdfjs。
    // 必须接住 reject：它内部 await getDestination(dest)，「点一个大纲条目后马上
    // 切走 tab」文档就被销毁了，一秒内就能复现一条 unhandled rejection。
    bundleRef.current?.linkService
      .goToDestination(
        dest as Parameters<
          InstanceType<ViewerModule["PDFLinkService"]>["goToDestination"]
        >[0],
      )
      .catch((error: unknown) => {
        console.warn("PDF outline navigation failed:", error);
      });
  }, []);

  const applyScale = useCallback((next: number) => {
    const viewer = bundleRef.current?.viewer;
    if (!viewer) return;
    const clamped = Math.min(Math.max(next, MIN_SCALE), MAX_SCALE);
    scaleValueRef.current = String(clamped);
    viewer.currentScale = clamped;
  }, []);

  const zoomIn = useCallback(() => {
    const viewer = bundleRef.current?.viewer;
    if (viewer) applyScale(viewer.currentScale * SCALE_STEP);
  }, [applyScale]);

  const zoomOut = useCallback(() => {
    const viewer = bundleRef.current?.viewer;
    if (viewer) applyScale(viewer.currentScale / SCALE_STEP);
  }, [applyScale]);

  const fitWidth = useCallback(() => {
    const viewer = bundleRef.current?.viewer;
    const container = containerRef.current;
    if (!viewer || !container) return;
    scaleValueRef.current = FIT_WIDTH;
    applyFitWidth(viewer, container);
  }, []);

  const dispatchFind = useCallback(
    (type: "" | "again", query: string, findPrevious: boolean) => {
      bundleRef.current?.eventBus.dispatch("find", {
        source: null,
        type,
        query,
        caseSensitive: false,
        entireWord: false,
        highlightAll: query.length > 0,
        findPrevious,
        matchDiacritics: false,
      });
    },
    [],
  );

  const find = useCallback(
    (query: string) => {
      queryRef.current = query;
      dispatchFind("", query, false);
    },
    [dispatchFind],
  );

  const findAgain = useCallback(
    (previous: boolean) => {
      // type:"again" 也必须带上原查询词。PDFFindController 每次都从 state.query
      // 重新取词，传 undefined 会被它当成空查询，结果是清空高亮而不是跳下一处。
      dispatchFind("again", queryRef.current, previous);
    },
    [dispatchFind],
  );

  const clearFind = useCallback(() => {
    queryRef.current = "";
    dispatchFind("", "", false);
    setFindMatchIndex(0);
    setFindMatchCount(0);
    setFindNotFound(false);
  }, [dispatchFind]);

  const reload = useCallback(() => setEpoch((n) => n + 1), []);

  return {
    containerRef,
    viewerRef,
    status,
    errorKind,
    pageNumber,
    pageCount,
    scale,
    outline,
    findMatchIndex,
    findMatchCount,
    findNotFound,
    goToPage,
    goToDest,
    zoomIn,
    zoomOut,
    fitWidth,
    find,
    findAgain,
    clearFind,
    reload,
  };
}
