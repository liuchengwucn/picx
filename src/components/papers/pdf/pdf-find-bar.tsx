import { ChevronDown, ChevronUp, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DISABLED_BTN,
  ICON_BTN,
  TOOL_BTN,
} from "#/components/reader/reader-ui";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

/** 工具栏搜索按钮的 aria-controls 指向这里。一页只有一个 PDF 面板，静态 id 够用。 */
export const PDF_FIND_BAR_ID = "pdf-find-bar";

/**
 * 输入停顿多久才真正发起检索。
 *
 * 刻意取得比直觉短：PDFFindController 自己对「新查询」还有一层 delay=250ms 的节流
 * （见 pdf_viewer.mjs 的 #onFind，type 为空时把 #nextMatch 塞进 setTimeout，下一次
 * find 事件会把它清掉），真正的全文遍历不会逐字符跑。这一层只是省掉每敲一个键都
 * 派发一次事件、走一遍 React 重渲染；再拖长就是白白叠加在那 250ms 上的手感延迟。
 */
const DEBOUNCE_MS = 140;

export interface PdfFindBarProps {
  /** 当前命中的序号（1 起）；0 表示尚无选中命中 */
  matchIndex: number;
  matchCount: number;
  /** pdf.js 判定「整篇都没有」才为 true；检索途中一律 false */
  notFound: boolean;
  onSearch: (query: string) => void;
  onAgain: (previous: boolean) => void;
  onClose: () => void;
}

/**
 * PDF 页内搜索条：钉在工具栏下方，不做浮层。
 *
 * 不浮层是因为 PDF 面板本身就是个定高滚动区，浮层会压住正文第一行——而搜索命中
 * 恰恰经常被 pdf.js 滚到视口顶部（scrollMatchIntoView 用的是 block:"start"），
 * 浮层正好盖住用户要看的那一条。钉在流里只是把滚动区压矮约 38px，宽度不变，
 * usePdfViewer 的 ResizeObserver 有宽度守卫，纯高度变化不会重算「适宽」倍率，
 * 也就走不到那条「重新赋 currentScaleValue 会顺带 clearSelection()」的路上去。
 * 但别据此以为「开合搜索条不动选区」：打开时下面那个 effect 要聚焦输入框，而
 * Chromium 里聚焦任何 input 都会清掉文档选区。选区是被焦点清的，不是被 resize 清的。
 *
 * 纯 props 组件：不碰 pdfjs，也不自己持有任何检索状态。关闭时清高亮由调用方负责
 * （工具栏按钮再点一次也是关闭路径，那条路走不到这个组件里来）。
 */
export function PdfFindBar({
  matchIndex,
  matchCount,
  notFound,
  onSearch,
  onAgain,
  onClose,
}: PdfFindBarProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // 已经真正派发出去的查询词。既用来给 debounce 去重，也用来判断「回车时输入框里
  // 的词有没有落地」——见下面 handleKeyDown。
  const searchedRef = useRef("");
  /** 待发的 debounce 定时器。回车抢跑时要能把它掐掉，见 runAgain。 */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 打开即聚焦输入框：搜索条是用户主动召唤出来的，多按一次 Tab 才能打字很别扭。
  // 卸载时把焦点还给召唤它的那个元素（正常就是工具栏的搜索按钮）。归还不是锦上添花：
  // 三条关闭路径里有两条（搜索条自己的 X、Esc）都是「持有焦点的元素随搜索条一起
  // 卸载」，不还就掉回 <body>——此后 PageDown 不再翻 PDF（滚动容器的 tabIndex=0 白
  // 加了），Tab 也要从整页头部重来。而 Esc/X 恰恰是这个控件最主要的退出方式。
  // 第三条路径（再点一次工具栏的搜索按钮）不会抢焦点也不会闪：那时焦点本来就在这个
  // 按钮上，对已聚焦元素调 focus() 是空操作，不派发 blur/focus。
  // isConnected 守卫兜住「记下的元素自己已经离开文档」的情况——那时 focus() 只会静默
  // 失败，判一下是为了让读代码的人知道这里想过这件事，而不是漏了。
  // 用 ref + 手动 focus() 而非 JSX 的 autoFocus，避开 biome 的 noAutofocus 规则。
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    // 挂载时 query 与 searchedRef 都是空串，这一跳直接跳过：不然刚打开搜索条就会派发
    // 一次空查询，白走一轮 dispatch + 一次 FindState.FOUND 回调（把 index/count/
    // notFound 三个 state 原样设回默认值，纯噪音）。
    //
    // 别把这层去重当成性能优化：pdf.js 的 #extractText() 是每文档一次的（结果缓存在
    // _extractTextPromises 里，只有 setDocument 才 #reset()），被这里挡掉的那次全文
    // 抽取并没有省下来，只是推迟到下一个 find 事件——而关闭路径的 clearFind() 会派发
    // 空 find，照样把它触发掉。58 页/9.4MB 那篇实测：冷启动直接搜 411ms，先「开→不
    // 打字→关」再搜 412ms，差值为 0。
    //
    // 反过来，用户把已输入的词删空时 searchedRef 是旧词，这里照常派发——那是
    // 「清掉高亮」的正常语义，不能跳。
    if (query === searchedRef.current) return;
    const timer = setTimeout(() => {
      timerRef.current = null;
      searchedRef.current = query;
      onSearch(query);
    }, DEBOUNCE_MS);
    timerRef.current = timer;
    return () => clearTimeout(timer);
  }, [query, onSearch]);

  const runAgain = (previous: boolean) => {
    // 回车比 debounce 快是常态（打完词立刻按回车）。此时这个词还没派发过，
    // findAgain 会拿 usePdfViewer 里的旧查询词去「跳下一处」——旧词是空串的话
    // 直接清掉高亮，看着像按了个没反应的键。这种情况改为立即发起本次检索：
    // pdf.js 的新查询本来就会跳到第一条命中。
    if (query !== searchedRef.current) {
      // 掐掉待发的定时器，否则它稍后会把同一个词再检索一遍，把用户刚翻到的命中
      // 又拽回第一条。
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      searchedRef.current = query;
      onSearch(query);
      return;
    }
    onAgain(previous);
  };

  // 键盘处理挂在搜索条**根节点**上，靠 React 的合成事件冒泡把输入框和三个按钮的按键
  // 一并收进来。挂在输入框上不够：Tab 到「下一条」连点几下翻命中之后按 Esc 什么都不
  // 会发生，而那正是键盘用户最容易走到的位置。
  //
  // 刻意不学 PdfOutlineDrawer 用 window 监听：抽屉是 aria-modal，开着的时候整页只剩
  // 它可交互，全局 Esc 名正言顺；搜索条不是模态，它开着时正文、工具栏、右侧 chat 都
  // 照常能用，抢下全局 Esc 就等于「焦点在别处按 Esc」会关掉一个用户当下没在操作的
  // 控件——大纲抽屉同时开着时一次 Esc 会把两个一起关掉，Task 7 的选中气泡也要用 Esc
  // 收起。代价是焦点落在 PDF 正文里时 Esc 不管用，那时还有 X 和工具栏按钮两个出口。
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      // 组字中的 Esc 是「取消候选」，不是「关掉搜索条」。日文输入法下敲错字想撤回
      // 候选窗，结果整个搜索条连同关键词一起没了——这是原生 find bar 都不会做的事。
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Enter") return;
    // Enter 只对输入框有意义：落在上/下/关闭按钮上的 Enter 是「激活按钮」，在这里
    // preventDefault 会让三个按钮再也按不动。
    if (event.target !== inputRef.current) return;
    // 中日文输入法组字中的回车是「确认候选」，不是「找下一条」。不拦住的话
    // 每敲定一个候选词都会顺带跳一次命中。
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    runAgain(event.shiftKey);
  };

  // 检索途中 matchCount 会先归零再逐页涨上来，只按它判空会让计数区在打字过程中
  // 闪出「无匹配结果」。以 pdf.js 的终态 notFound 为准，计数没出来就先什么都不显示。
  const status =
    query === ""
      ? ""
      : notFound
        ? m.pdf_search_no_results()
        : matchCount > 0
          ? m.pdf_search_count({ current: matchIndex, total: matchCount })
          : "";
  // 没输入词、或这个词一条都没命中时，上下条按钮无处可去。用 notFound 而不是
  // matchCount===0 兜住检索中途那段计数为 0 的窗口，避免按钮闪一下禁用。
  const canNavigate = query !== "" && !notFound;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 这不是把 div 做成控件，而是给一条已有的工具条做键盘事件委托——真正的交互元素是里面的 input 与三个 button，它们各自的按键靠冒泡收到这里，根节点自身既不可聚焦也不需要角色
    <div
      id={PDF_FIND_BAR_ID}
      onKeyDown={handleKeyDown}
      className="flex shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--parchment-warm)] px-3 py-1.5"
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={m.pdf_search_placeholder()}
        aria-label={m.pdf_search_placeholder()}
        className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-sm text-[var(--ink)] outline-none focus:border-[var(--academic-brown)]"
      />
      {/* 计数是异步涨出来的，读屏用户光靠焦点在输入框上不会知道结果变了 */}
      <output className="shrink-0 text-xs tabular-nums text-[var(--ink-soft)]">
        {status}
      </output>
      <button
        type="button"
        className={cn(TOOL_BTN, ICON_BTN, DISABLED_BTN)}
        onClick={() => runAgain(true)}
        disabled={!canNavigate}
        aria-label={m.pdf_search_prev()}
        title={m.pdf_search_prev()}
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={cn(TOOL_BTN, ICON_BTN, DISABLED_BTN)}
        onClick={() => runAgain(false)}
        disabled={!canNavigate}
        aria-label={m.pdf_search_next()}
        title={m.pdf_search_next()}
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={cn(TOOL_BTN, ICON_BTN)}
        onClick={onClose}
        aria-label={m.pdf_search_close()}
        title={m.pdf_search_close()}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
