import { type RefObject, useLayoutEffect, useRef, useState } from "react";

/**
 * 小于这个像素数的余量不值得再试升一档: 升上去几乎必然溢出, 白费两次渲染。
 * 取 16 是因为最小的一档增量(周刊卡把一个方向从「只有名字」升成「带标题」)
 * 实测也在 34px 上下。
 */
const MIN_SLACK = 16;

/**
 * 档位探测的决策函数。抽成纯函数只为可测 —— jsdom 里量不到真实布局,
 * 而这个状态机(尤其是「升过头要退回一档」和「level 0 不能退到 -1」)正是
 * 容易写错的地方。
 *
 * @param slack    spacer 的实测高度, 即卡内还没被任何人吃掉的余量
 * @param level    当前档位
 * @param maxLevel 最高档位(含)
 */
export function nextFitLevel(
  slack: number,
  level: number,
  maxLevel: number,
): { level: number; done: boolean } {
  if (slack < MIN_SLACK) {
    // 填满了, 或者刚刚升过头把余量吃成了 0(乃至溢出)。后一种要退回一档。
    // level > 0 的守卫挡住「level 0 就溢出」(极端窄屏 + 超长标题)退到 -1。
    return { level: level > 0 ? level - 1 : 0, done: true };
  }
  if (level >= maxLevel) return { level, done: true };
  return { level: level + 1, done: false };
}

export interface FitLevel {
  /** 当前档位, 0 = SSR 档 */
  level: number;
  /** 挂在卡内「分级内容之后、尾链之前」的那个 grow 空 div 上 */
  spacerRef: RefObject<HTMLDivElement | null>;
  /** 挂在卡片外壳上, 只用来监听宽度变化 */
  containerRef: RefObject<HTMLElement | null>;
}

/**
 * 让卡片的内容量随可用高度动态升档。
 *
 * 用法: 在卡内插一个 `<div ref={spacerRef} className="grow" aria-hidden />`,
 * 放在分级内容之后、尾链之前。它的高度就是「还没被任何人吃掉的余量」, 于是
 * 「还能不能再放一档」变成一次 getBoundingClientRect —— 不需要估算任何一档
 * 的高度, 试探即测量。
 *
 * 三条不变式(改这个文件之前先读一遍):
 *
 * 1. **SSR 恒为 level 0**, 客户端只升不降。首帧到终态只会「填上空白」而不会
 *    「内容跳掉」, 也不产生 hydration mismatch。
 * 2. **升档不得让 spacer 归零** ⇒ 升档永不推高 grid ⇒ 同一排里的几张卡各自
 *    独立收敛, 不需要跨卡协调, 也堵掉了「A 卡升档 → 整排变高 → B 卡余量变多
 *    → 再升档」的正反馈。
 * 3. **均分负责微调, spacer 负责宏调**。分级列表的条目保留 flex-1 但要收紧
 *    max-h: flex 的分配算法里触发 max-height 的项会被冻结、剩余空间回流给未
 *    冻结的兄弟, 于是条目各拿 min(均分份额, 封顶), spacer 拿走全部剩余。
 *    去掉 flex-1 会让余量全堆到 spacer(尾链上方), 低频日直接退回空洞。
 *
 * 为什么是 useLayoutEffect 而不是 useEffect: 后者在 paint 之后跑, 升档过程会
 * 变成用户可见的闪烁。React 保证 layout effect 在 DOM 变更后、浏览器 paint 前
 * 同步执行, 且 effect 内的 setState 会被同步 flush 并重跑 layout effect ——
 * 整个升档循环因此在同一帧内收敛, 浏览器只 paint 最终状态。渲染次数上界是
 * 档数 + 1。
 *
 * 哪些卡用得上它是**拓扑决定的**: 首页那排网格只有两行, 跨两行的卡(资讯、
 * 周刊)高度由别人决定, 能测到余量; 而每行里唯一的那张卡(论文、助手)高度就是
 * 它自己, spacer 恒为 0, 接了也一次升不上去。别给它们套。
 *
 * 移动端单列没有 stretch 余量, spacer 同样恒为 0, level 停在 0, 机制完全不
 * 启用。无 JS / 爬虫同理。
 */
export function useFitLevel(maxLevel: number): FitLevel {
  const [level, setLevel] = useState(0);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const probing = useRef(true);
  const lastWidth = useRef(-1);

  // 刻意不带依赖数组: 每次渲染后都要重测, 因为上一轮的 setLevel 改变了布局。
  useLayoutEffect(() => {
    if (!probing.current) return;
    const spacer = spacerRef.current;
    if (!spacer) return;
    const next = nextFitLevel(
      spacer.getBoundingClientRect().height,
      level,
      maxLevel,
    );
    if (next.done) probing.current = false;
    if (next.level !== level) setLevel(next.level);
  });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // 只观察宽度, 绝不观察高度: 高度随升档变化, 会自激。升档只改卡内内容
    // 不改卡宽, 所以这个 observer 不会被自己触发。
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? -1;
      const prev = lastWidth.current;
      lastWidth.current = width;
      // 首次回调只登记宽度: 它是异步的, 那时升档循环已经收敛完了,
      // 无条件重置会把刚探到的档位打回 0。
      if (prev < 0 || width === prev) return;
      probing.current = true;
      setLevel(0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { level, spacerRef, containerRef };
}
