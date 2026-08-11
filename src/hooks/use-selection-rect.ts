import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface SelectionRect {
  /** 视口坐标：调用方的气泡用 position:fixed，直接吃 getClientRects 的值 */
  top: number;
  bottom: number;
  centerX: number;
}

export interface SelectionRectState {
  rect: SelectionRect;
  /**
   * **已裁剪到 root 之内**的选中文本，且是**渲染文本**（行/块边界带换行）。
   *
   * 两个限定各修一个坑，缺一不可：
   * - 裁剪：原生选区可以横跨整页：Ctrl+A、以及从正文里往外拖到面板边缘触发浏览器
   *   自动滚动，都会让 Range 顺着 DOM 顺序一路吃进导航栏、右侧 chat 面板、页脚，
   *   甚至气泡自己的按钮文案。不裁就是把整页 chrome 当引文发出去。
   * - 渲染文本：`Range.toString()` 按文本节点直接拼接，**不认行/块边界**，只有
   *   `Selection.toString()` 走渲染文本算法才会补换行。pdf.js 的文本层是每个视觉行
   *   之间夹一个 `<br role="presentation">`（textContent 是空串），于是用
   *   `Range.toString()` 会把相邻两行焊死：实测 `for` + `large` → `forlarge`、
   *   `infer-` + `ence` → `infer-ence`。引文是要送进 LLM 的，粘连词必须消掉。
   *
   * 注意与下面的 range 不是同一个语义：text 是「用户在 root 里选中的东西」，
   * range 是「用户选中的东西」原样。
   */
  text: string;
  /**
   * 选区的静态快照（cloneRange），**不裁剪**。document.getSelection() 拿到的 Range
   * 是活的，会随后续选择变化而改变；存进 state 前必须克隆，否则消费者读到的是
   * 「当前」选区而不是产生这个 state 时的选区。
   *
   * 刻意保留未裁剪的边界：quote-share 的 rangeToAnchor 自己就承诺「选区跨出 article
   * 时裁剪到 article 内的部分」，并且要靠原始端点去解析块内偏移；替它先裁一刀会把
   * 端点挪到块边界上，锚点偏移随之改变。要纯文本的用 text，要选区语义的用 range。
   */
  range: Range;
  /**
   * **已裁剪到 root 之内**的选区快照。要「用户到底选了什么」的精确 DOM 形状就用它：
   * text 是拍平成字符串之后的结果，拿不回块结构；range 又没裁剪。
   */
  clippedRange: Range;
}

/**
 * 把 range 收拢到 root 之内。端点落在 root 外面时收到 root 的首/尾，端点本来就在
 * 里面则原样保留。调用前必须已确认 range 与 root 相交，否则会得到一个空区间。
 *
 * 顺序无关紧要：相交前提下，跑出 root 的端点只可能跑在 root 的外侧那一头，
 * setStart/setEnd 都不会把区间折叠掉。
 */
/**
 * 会在渲染文本里断行的标签。刻意用白名单而不是 `getComputedStyle(display)`：这里拿到
 * 的是 `cloneContents()` 出来的游离片段，脱离文档就没有 used value 可读。
 *
 * 名单宁滥勿缺：下游（`normalizePdfSelection`）会把所有空白折成单空格，多发一个换行
 * 不留痕迹，少发一个就是两个词焊死。
 */
const BLOCK_LEVEL_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

/**
 * 把一棵 DOM 子树序列化成「渲染文本」：文本节点原样收下，`<br>` 与块级元素的边界发
 * 一个换行。行内元素（pdf.js 文本层里同一视觉行上的相邻 `<span>`）之间**不补任何东
 * 西**——那些 span 视觉上本来就是紧挨着的，凭空插空格会把 `Index` + `Cache` 拆成
 * `Index Cache`。
 *
 * 导出是为了单测：这一层正是 `Range.toString()` 与浏览器渲染文本的差异所在，而那个
 * 差异曾经整整一轮没人发现（下游 `normalizePdfSelection` 的「把硬换行折成空格」因此
 * 从未被触发过）。测它必须喂真实的 pdf.js 文本层形状。
 */
export function renderedTextOf(
  root: Node,
  options?: {
    /**
     * 命中时把整棵子树折算成返回的字符串、不再深入（返回空串 = 原子且无文本）。
     * 返回 null/undefined = 不是原子子树，照常递归。
     *
     * 存在的理由：markdown 正文里 KaTeX 的 .katex-mathml 是 clip 视觉隐藏、仍在
     * 渲染树里，照常递归会把 MathML 那份文本一并收进来（同一个公式出现两遍）。
     * 但「什么算原子」是调用方的领域知识，本 hook 只负责块边界的换行规则。
     */
    atomicTextOf?: (el: Element) => string | null | undefined;
  },
): string {
  const parts: string[] = [];

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    // != null 而不是真值判断：返回空串的语义是「原子但无文本」，真值判断会让它继续
    // 递归、把本该被折算掉的子树（KaTeX 的 MathML 副本）泄漏出来。
    const atomic = options?.atomicTextOf?.(node as Element);
    if (atomic != null) {
      parts.push(atomic);
      return;
    }
    const tag = (node as Element).tagName;
    if (tag === "BR") {
      parts.push("\n");
      return;
    }
    const isBlock = BLOCK_LEVEL_TAGS.has(tag);
    if (isBlock) parts.push("\n");
    for (const child of Array.from(node.childNodes)) visit(child);
    if (isBlock) parts.push("\n");
  };

  for (const child of Array.from(root.childNodes)) visit(child);
  return parts.join("");
}

/**
 * 「裁剪后区间的渲染文本」。两个要求得同时满足，所以分两条路：
 *
 * - 裁剪没真的动过端点（绝大多数正常拖选都是这样）：直接用 `Selection` 的字符串化。
 *   它走的就是渲染文本算法，是浏览器自己的口径，比我们手写的白名单准，还不用付任何
 *   额外代价（实测整页 6607 字符 `toString()` 0.02ms）。
 * - 真裁掉了东西（Ctrl+A、从容器外拖进来）：`Selection` 的字符串化包含被裁掉的部分，
 *   用不了，只能自己序列化克隆片段（实测每页 0.65ms，只在这条稀有路径上付）。
 *
 * `rangeCount === 1` 是必要条件：Firefox 允许多段选区，而 `Selection.toString()` 会
 * 把所有段拼起来，跟我们只取 `getRangeAt(0)` 的口径对不上。
 */
function clippedRenderedText(
  selection: Selection,
  range: Range,
  clipped: Range,
): string {
  const boundariesIntact =
    selection.rangeCount === 1 &&
    clipped.compareBoundaryPoints(Range.START_TO_START, range) === 0 &&
    clipped.compareBoundaryPoints(Range.END_TO_END, range) === 0;
  return boundariesIntact
    ? selection.toString()
    : renderedTextOf(clipped.cloneContents());
}

function clipRangeTo(range: Range, root: Node): Range {
  const clipped = range.cloneRange();
  if (!root.contains(clipped.startContainer)) {
    clipped.setStart(root, 0);
  }
  if (!root.contains(clipped.endContainer)) {
    clipped.setEnd(root, root.childNodes.length);
  }
  return clipped;
}

/**
 * 监听某个根节点内的文本选中，产出气泡所需的文本与视口坐标。
 *
 * 三个信号缺一不可：selectionchange 覆盖键盘选中与双击选词；pointerdown/up 用来在
 * 拖拽过程中压住气泡（否则拖选时气泡会跟着乱跳）；scroll/resize 用来重算坐标。
 * 全部经 rAF 合流，避免拖选时每像素一次布局读取。
 *
 * 原本这套逻辑长在 quote-share 的 useSelectionBubble 里，PDF 的「问这段」需要
 * 一模一样的纪律但不需要 markdown 深链锚点，故抽到这里作为共同底座。
 */
export function useSelectionRect(rootRef: RefObject<HTMLElement | null>): {
  state: SelectionRectState | null;
  dismiss: () => void;
} {
  const [state, setState] = useState<SelectionRectState | null>(null);
  const draggingRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  /**
   * 「用户已经主动打发掉这个气泡了」的闩。
   *
   * 收起气泡不清 DOM 选区（Esc 之后用户往往还想复制那段文字），可选区还在，下一次
   * scroll/resize 重算就会把气泡原样送回来——PDF 面板里滚动是家常便饭，实测按完 Esc
   * 只要往下滚 30px 气泡就自己回来了，Esc 等于没按。闩住之后要等用户下一次动作
   * （改选区或在别处按下指针）才解除，所以不存在「永久关掉」的死路。
   */
  const dismissedRef = useRef(false);

  const evaluate = useCallback(() => {
    const root = rootRef.current;
    const selection = document.getSelection();
    if (!root || !selection || selection.rangeCount === 0) {
      setState(null);
      return;
    }
    if (selection.isCollapsed) {
      setState(null);
      return;
    }
    const range = selection.getRangeAt(0);
    // 这里刻意用 intersectsNode 而不是 root.contains(commonAncestorContainer)：
    // 从正文外面（标题、页边空白）往正文里拖，以及 Ctrl+A 全选，都会让
    // commonAncestorContainer 落到 root 的祖先上，contains 判定会把这两种极常见的
    // 选法整个判死。quote-share 的 rangeToAnchor 本来就承诺「选区跨出 article 时
    // 裁剪到 article 内的部分」，这道门只负责排掉「压根没碰到 root」的选区。
    if (!range.intersectsNode(root)) {
      setState(null);
      return;
    }
    // 相交只说明「碰到了 root」，选区照样可以一路吃到 root 外面去。文本与坐标都以
    // 裁剪后的区间为准，原始 range 只作为快照原样交出去（见 SelectionRectState）。
    const clipped = clipRangeTo(range, root);
    const text = clippedRenderedText(selection, range, clipped);
    if (!text.trim()) {
      setState(null);
      return;
    }
    // 可见范围 = 视口 ∩ root 的盒子。只用视口是不够的：PDF 面板是个定高、
    // overflow-hidden 的内部滚动区，被它裁掉的那部分内容 getClientRects 照样返回
    // 坐标，气泡会飘到面板外面去盖住页面上别的东西（实测：选区尾部落在面板下沿
    // 之外时，气泡落在下方「相关论文」列表上）。markdown 正文那边 root 是随文档流
    // 的 <article>，这个交集恒等于视口，行为不变。
    const rootBox = root.getBoundingClientRect();
    const viewTop = Math.max(0, rootBox.top);
    const viewBottom = Math.min(window.innerHeight, rootBox.bottom);
    const viewLeft = Math.max(0, rootBox.left);
    const viewRight = Math.min(window.innerWidth, rootBox.right);
    // width 与 height 必须同时为正（不是 ||）：跨行选区的 getClientRects 里散布着
    // 「零宽但有行高」的退化矩形——选区端点落在换行符之后时，那一项就是下一行行首
    // 宽度为 0 的插入点（curILQ 第 11 页整页选区实测有 9 个，全是 left=right=134
    // 的竖条，正好压在页面左边距上）。它们的 centerX 没有意义：真让某一个成了
    // 「最后一个可见的」，气泡就会被锚到页边距上，所以一律排除。
    const rects = Array.from(clipped.getClientRects()).filter(
      (r) =>
        r.width > 0 &&
        r.height > 0 &&
        r.bottom > viewTop &&
        r.top < viewBottom &&
        r.right > viewLeft &&
        r.left < viewRight,
    );
    // 取「最后一个可见的」而不是「最后一个」。PDF 文本层的 DOM 顺序不等于视觉顺序，
    // 一次视觉上连续的拖选，Range 的终点完全可能落在视觉上别处、甚至已被裁掉的地方；
    // 只看末位 rect 会让气泡钉在用户根本没看见的位置上。
    const last = rects[rects.length - 1];
    if (!last) {
      setState(null);
      return;
    }
    // 再与可见带求一次交：相交只保证「有一部分能看见」，rect 本身可以大得离谱。
    // 选区整段包住一个 .page 时 getClientRects 会产出整页的块盒（实测 height=1163，
    // bottom 落在视口下方 500 多像素），直接拿它的 bottom 当锚点，气泡会被放到
    // 屏幕外面去。锚点只能是这个矩形**看得见的那一块**。
    const top = Math.max(last.top, viewTop);
    const bottom = Math.min(last.bottom, viewBottom);
    const left = Math.max(last.left, viewLeft);
    const right = Math.min(last.right, viewRight);
    setState({
      rect: { top, bottom, centerX: (left + right) / 2 },
      text,
      range: range.cloneRange(),
      // clipped 已经是 clipRangeTo 里 cloneRange 出来的独立对象，不必再克隆一次
      clippedRange: clipped,
    });
  }, [rootRef]);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (!draggingRef.current && !dismissedRef.current) {
        evaluate();
      }
    });
  }, [evaluate]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // 点在气泡自己身上不算重新拖选，否则按钮会在 pointerdown 阶段就被卸载、click 永远不触发
      if (target?.closest?.("[data-quote-bubble]")) {
        return;
      }
      // 在别处按下指针就是新一轮交互，之前那次「打发掉」到此为止
      dismissedRef.current = false;
      draggingRef.current = true;
      setState(null);
    };
    // pointerup 之外还要兜底 pointercancel 与 blur：拖到窗口外再松手（触控板/鼠标
    // 移出窗口）、触控笔中途取消、拖拽过程中窗口失焦，都不会给 document 发 pointerup，
    // draggingRef 会永远卡在 true。而 schedule() 里 `!draggingRef.current` 这道门连
    // selectionchange（键盘 Shift+方向键选中）也一起挡住，纯键盘用户会因此看起来
    // 「选中」整个失效，直到随便点一下页面才能自愈——所以必须主动兜底，不能指望
    // pointerup 总会到达。
    const endDrag = () => {
      draggingRef.current = false;
      schedule();
    };
    // 选区本身变了（键盘 Shift+方向键、双击选词、重新拖选）也解闩：那是新的一段选中，
    // 上一次的「不想要这个气泡」不该继续压着它。
    const onSelectionChange = () => {
      dismissedRef.current = false;
      schedule();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissedRef.current = true;
        setState(null);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKeyDown);
    // capture:true —— 正文在可滚动容器里时，事件不冒泡到 window
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.addEventListener("blur", endDrag);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("blur", endDrag);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [schedule]);

  // dismiss 同样上闩，为的是「收下选中之后选区仍然留着」的调用方：quote-share 点完
  // 「分享这段」会开弹窗但不动选区，不上闩的话弹窗一关、随便滚一下气泡就回来了。
  // （PDF 的「问这段」不靠这个闩——它紧接着就 removeAllRanges()，选区本身没了。）
  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setState(null);
  }, []);
  return { state, dismiss };
}
