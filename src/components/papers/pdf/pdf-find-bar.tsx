import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
 * usePdfViewer 的 ResizeObserver 只认宽度变化，因此「适宽」倍率与用户选区都不受
 * 影响（否则每次开关搜索条都会清一次选区）。
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
  // 的词有没有落地」——见下面 onKeyDown。
  const searchedRef = useRef("");
  /** 待发的 debounce 定时器。回车抢跑时要能把它掐掉，见 runAgain。 */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 打开即聚焦：搜索条是用户主动召唤出来的，多按一次 Tab 才能打字很别扭。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    // 挂载时 query 与 searchedRef 都是空串，这一跳直接跳过：不然刚打开搜索条就会
    // 派发一次空查询，而 pdf.js 收到 find 事件的第一件事是 #extractText() 抽取全文
    // （58 页那篇要跑满一轮 getTextContent），纯属白烧。
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
    <div
      id={PDF_FIND_BAR_ID}
      className="flex shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--parchment-warm)] px-3 py-1.5"
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== "Enter") return;
          // 中日文输入法组字中的回车是「确认候选」，不是「找下一条」。不拦住的话
          // 每敲定一个候选词都会顺带跳一次命中。
          if (event.nativeEvent.isComposing) return;
          event.preventDefault();
          runAgain(event.shiftKey);
        }}
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
