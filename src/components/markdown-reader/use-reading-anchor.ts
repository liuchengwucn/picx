import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * 视口顶部的参照线（px）：与页面里 sticky 侧栏的 `top-24` 对齐，约等于站点 header 下沿。
 * 只用来决定「挑哪一块当锚点」，取值稍有偏差不影响补偿精度——补偿对齐的是同一个块的
 * 同一相对位置，参照线只是选块的判据。
 */
const ANCHOR_LINE_PX = 96;

/** 小于半像素的位移不值得动滚动条，纯属重排噪声 */
const MIN_CORRECTION_PX = 0.5;

interface ReadingAnchor {
  el: Element;
  /**
   * null = 对齐块顶（锚点块整体落在参照线下方，重排不改变它上沿的位置）；
   * 否则 = 对齐「块内这个比例处」，块高变了按新高度还原，跨屏长段落才不会段内漂移。
   */
  ratio: number | null;
  /** 记录时那个参考点在视口中的 y；补偿就是把它还原回来 */
  refY: number;
  /** 拖拽期间为 true：补偿后保留锚点，供后续每一帧继续对齐同一个位置 */
  hold: boolean;
}

// SSR 没有 layout 阶段。useEffect 在服务端同样不执行，换掉只是为了绕开 React 对
// useLayoutEffect 的 SSR 告警。
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * 长正文的「阅读位置锚定」。
 *
 * 页面是 window 滚动，正文行宽由中栏宽度决定（见 .reader-prose 的 max-width）。收起 /
 * 展开聊天栏、拖动栏宽把手都会改变中栏宽度，正文随之重新断行、整篇高度大幅变化，而
 * window.scrollY 一动不动——读者眼前那一段就被顶走好几屏，心流直接断掉。
 *
 * 用法：在触发布局变化「之前」（事件处理函数里，此时读到的还是旧布局）调 capture()，
 * 把 layoutKey 换成新值；DOM 提交后本 hook 的 layout effect 会在浏览器绘制前把滚动位置
 * 补回去，锚点块停在原处。连续变化（拖拽）用 capture({ hold: true }) + release()。
 *
 * @param getRoot 取当前正文根节点；锚点从它的直接子元素里挑。用函数而不是 ref，是因为
 *   论文页有「总结 / 原文」两个视图，各自的正文容器不同，得按当前视图现取。
 * @param layoutKey 把所有会改变正文宽度的量拼成一个字符串，变了就补偿一次
 */
export function useReadingAnchor(
  getRoot: () => HTMLElement | null,
  layoutKey: string,
) {
  const anchorRef = useRef<ReadingAnchor | null>(null);

  const capture = useCallback(
    (options?: { hold?: boolean }) => {
      anchorRef.current = null;
      const root = getRoot();
      if (!root) return;
      const hold = options?.hold ?? false;

      // 参照线之下的第一个非空子元素就是读者正在看的那一块
      for (const child of root.children) {
        const rect = child.getBoundingClientRect();
        // 零高节点（隐藏元素、纯锚点 span）当锚点没有意义，比例也会除零
        if (rect.height <= 0) continue;
        if (rect.bottom <= ANCHOR_LINE_PX) continue;
        const inside = rect.top <= ANCHOR_LINE_PX;
        anchorRef.current = {
          el: child,
          ratio: inside ? (ANCHOR_LINE_PX - rect.top) / rect.height : null,
          refY: inside ? ANCHOR_LINE_PX : rect.top,
          hold,
        };
        return;
      }

      // 正文整个在参照线之上：读者已经翻过全文，眼前是正文下方的相关论文那一带。
      // 那些块在 grid 之外，位置由 grid 行高决定（还受聊天栏那一列牵制），跟正文底边
      // 并不同步，拿正文里的锚点去补只会补错方向。这一段留给浏览器原生 scroll
      // anchoring——它在「变化点全在视口之上」时正是拿手好戏，实测把 87483px 的潜在
      // 位移压到了 270px，无需我们插手。
    },
    [getRoot],
  );

  const release = useCallback(() => {
    anchorRef.current = null;
  }, []);

  useIsomorphicLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    // 一次性锚点用完即弃，免得读者手动滚动之后下一次布局变化拿着过期坐标乱补
    if (!anchor.hold) anchorRef.current = null;
    // 切回总结视图等场景会把整棵 article 卸载，锚点跟着 detach
    if (!anchor.el.isConnected) return;

    const rect = anchor.el.getBoundingClientRect();
    const now =
      anchor.ratio === null ? rect.top : rect.top + anchor.ratio * rect.height;
    const delta = now - anchor.refY;
    if (Math.abs(delta) < MIN_CORRECTION_PX) return;
    // instant：正文里 TOC 跳转用的是 smooth，这里绝不能被带成动画——补偿必须在
    // 这一帧绘制前就位，否则读者仍会看到跳变
    window.scrollBy({ top: delta, behavior: "instant" });
  }, [layoutKey]);

  return { capture, release };
}
