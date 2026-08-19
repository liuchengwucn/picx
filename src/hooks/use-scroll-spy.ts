import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 滚动跟随高亮(scroll-spy): 给一组页内锚点算出「读者正在看第几个」, 并提供跳转。
 *
 * 三条不变式, 每一条都对应一个实测出来的 bug, 改动前请先读完:
 *
 * 1. **只能观测细高度的锚点元素**(标题/栏眉), 不能观测整个 <section>。判定带只有
 *    一两百 px 高, 而两个相邻 section 在视口里几乎总是同时存在 —— 观测 section
 *    时「正在离开的那一栏」与「刚跳到的那一栏」会同批落在带内, DOM 顺序取第一个
 *    于是永远选中上面那个。实测: 390×844 点第 N 栏, 目标落位 top=144、上一栏底边
 *    还在 108(带上边界 104), 高亮 100% 落在第 N-1 栏。细锚点让「两项同时在带内」
 *    在结构上不可能发生。
 * 2. **点击必须立刻设 active**, 不能等 observer 回调。平滑滚动期间回调会连续触发,
 *    最终态才正确; 中途那一段若没有先手赋值, 用户看到的是高亮在别的项上晃。
 * 3. **滚到页面底部时钳到最后一项**。最后一栏的顶部永远滚不到判定带里(页面可滚
 *    距离不够), 不钳的话它永远无法高亮 —— 实测 1440×900 最大滚动 2470, 最后一栏
 *    顶部最多到 392, 而判定带 342 就结束了; 点它自己都高亮不上。
 *
 * 仓库里还有一份更早的实现: components/markdown-reader/reader-toc.tsx 的 useToc
 * (形状几乎相同, 但目录项是从 DOM 现扫的、还兼带层级树)。那一份服务另一个页面,
 * 本次不动; 将来若要合并, 这里是合并目标。
 */
export interface ScrollSpyOptions {
  /**
   * 判定带上边界距视口顶部的距离(px) —— 等于吸顶层的总高度, 被盖住的锚点不该算
   * 「正在看」。传函数: 吸顶栈高度依赖断点与 safe-area, 只能在浏览器里现量,
   * 不能在渲染期烧成常量(每次建/重建 observer 时求值一次)。
   */
  topOffset: number | (() => number);
  /**
   * 判定带下边界, 取视口高度的百分比。默认 62 = 只认上部 38% —— 不收窄的话一屏内
   * 同时可见的两三个锚点里最靠上那个会一直霸着高亮。视口相对值在 resize 时自校正。
   */
  bottomPercent?: number;
}

export function useScrollSpy(
  ids: readonly string[],
  { topOffset, bottomPercent = 62 }: ScrollSpyOptions,
): { activeId: string | null; jumpTo: (id: string) => void } {
  const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null);

  // topOffset 是函数时调用方每次渲染都会给一个新引用, 直接进依赖会让 observer
  // 白拆白建。用 latest-ref 取值, 真正的重建时机由 idKey / bottomPercent 决定。
  const topOffsetRef = useRef(topOffset);
  topOffsetRef.current = topOffset;

  // 依赖 id 串而不是数组: 调用方每次渲染都会 map 出新数组
  const idKey = ids.join(",");

  useEffect(() => {
    const list = idKey ? idKey.split(",") : [];
    const nodes = list
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;

    // 深链(#section-xxx)直接打开时, 浏览器已经滚到位, 但 observer 的首次回调要
    // 等一拍才到; 先按 hash 定一次, 免得首帧高亮在第一项上。
    const hashId = decodeURIComponent(window.location.hash.slice(1));
    if (hashId && list.includes(hashId)) setActiveId(hashId);

    // 自己记全量可见态: 回调只带「这次发生变化」的 entries, 光看这一批取最靠上的
    // 那个会在快速滚动(多个 entry 同批、且顺序不保证)时高亮跳到读者身后的锚点。
    const visible = new Set<string>();

    const atBottom = () =>
      window.scrollY + window.innerHeight >=
      document.documentElement.scrollHeight - 1;

    // 判定带上边界的当前值(px), 由 build() 写入。apply() 的几何兜底要用它。
    let bandTop = 0;

    // 见文件头不变式 3: 底部钳位必须与 observer 走同一个出口。若做成独立的 scroll
    // 监听各自 setState, IntersectionObserver 的回调是另一个任务, 可能排在最后一次
    // scroll 事件之后到达, 把刚钳好的最后一项又改回去。
    const apply = () => {
      if (atBottom()) {
        setActiveId(list[list.length - 1]);
        return;
      }
      // list 就是 DOM 顺序, 取第一个还落在判定带里的
      const first = list.find((id) => visible.has(id));
      if (first) {
        setActiveId(first);
        return;
      }
      // 带内空。可能只是停在某一栏正文中段, 但也可能是一次**跳跃式滚动**(拖滚动条 /
      // PageDown / 从锚点直接落位): 那一下所有锚点都没经过判定带, observer 一个
      // isIntersecting 都不会发, 保留旧值就等于把高亮钉在读者身后好几栏。实测 12 次
      // 随机跳滚有 4 次落在错的栏目上。所以这里直接按几何算: 最后一个已经滚过带上
      // 边界的锚点就是当前所在栏(顺带把「往上滚」那半边也算对了 —— 那种情况下也是
      // 一个锚点都不在带内)。
      let current: string | null = null;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= bandTop) current = id;
      }
      // 全在带下方 = 还没进第一栏(刊头位置), 高亮留在第一项
      setActiveId(current ?? list[0]);
    };

    let observer: IntersectionObserver | null = null;
    let rootMargin = "";
    const build = () => {
      const top =
        typeof topOffsetRef.current === "function"
          ? topOffsetRef.current()
          : topOffsetRef.current;
      bandTop = top;
      const next = `-${top}px 0px -${bottomPercent}% 0px`;
      if (observer && next === rootMargin) return;
      rootMargin = next;
      observer?.disconnect();
      // 重建会让每个已观测元素立刻补发一次 entry, visible 因此自动重算, 不必手清
      observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) visible.add(e.target.id);
            else visible.delete(e.target.id);
          }
          apply();
        },
        { rootMargin },
      );
      for (const n of nodes) observer.observe(n);
    };
    build();

    // resize: 下边界是视口百分比会自校正, 但上边界是 px —— 跨断点时吸顶栈换了一套
    // 高度(窄屏多一条吸顶行), 不重量就是拿旧布局的数在新布局上判定。
    const onResize = () => build();
    // apply() 在带内为空时要读 7 个 rect(强制布局), 每个 scroll 事件都跑一遍太贵 ——
    // 用 rAF 合并成每帧最多一次
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        apply();
      });
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true });
    apply();

    return () => {
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
    };
  }, [idKey, bottomPercent]);

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    setActiveId(id);
    // 锚点偏移交给目标元素的 scroll-margin-top, 与不带 JS 的 href 跳转同一口径
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // 刻意不写 URL hash(既不放行默认跳转, 也不 history.replaceState): @tanstack/history
    // 把 pushState/replaceState 都打了补丁, 任何一种写法都会被 router 当成一次导航
    // 并重跑当前路由的 loader —— 本地实测点一次 chip 就多跑一次 loader, 在客户端
    // 那是一次真实的数据请求。href 仍然留在 <a> 上(复制链接 / 不带 JS 时照常可用),
    // 只是点击不再改地址栏。
  }, []);

  return { activeId, jumpTo };
}
