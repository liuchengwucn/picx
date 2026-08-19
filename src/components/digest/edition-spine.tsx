import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useScrollSpy } from "#/hooks/use-scroll-spy";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

export interface SpineItem {
  slug: string;
  name: string;
  pickCount: number;
  accent: string;
}

/**
 * 吸顶栈的实测高度(px)。判定带上边界与栏目的 scroll-margin-top 必须是同一个数,
 * 否则跳转落位与高亮判定各说各话(实测差 16px 就足以让高亮永远落在上一栏)。
 *
 * 为什么不在 JS 里写常量、也不 getComputedStyle 读 --edition-sticky-stack: 那个
 * token 的值含 env(safe-area-inset-top)(刘海屏非 0)与断点分支(--edition-chip-h
 * 在 lg 归零), 而自定义属性读出来的是未求值的 token 流。塞一个探针元素让浏览器
 * 自己算, 拿到的就是当前布局下的真值。
 */
function measureStickyStack(): number {
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.height = "var(--edition-sticky-stack)";
  document.body.appendChild(probe);
  const h = probe.offsetHeight;
  probe.remove();
  return h;
}

/**
 * 「本期一览」。这一页的签名元素: 7 个方向同时更新是这份周刊的真实结构, 脊把它
 * 常驻在视野里, 顺便回答「共几栏 / 你在第几栏 / 各栏几篇」——而不是装饰。
 *
 * 宽屏是 sticky 竖脊, 窄屏收成吸顶横向 chip 行(同一份数据, 两套排版)。
 *
 * 锚点是裸 <a href="#section-...">, 不带 JS 也能跳; 带 JS 时 preventDefault 后交给
 * useScrollSpy 的 jumpTo(它刻意不写 URL hash —— 原因见那个 hook)。
 */
export function EditionSpine({
  items,
  showPastAnchor,
}: {
  items: SpineItem[];
  /** 页尾往期列表只在落地页出; 单期页没有那个锚点, 不能给一个跳不动的链接 */
  showPastAnchor?: boolean;
}) {
  // 观测的是每个栏目的栏眉 <h2>(细高度), 不是整个 <section> —— 见 useScrollSpy
  // 文件头不变式 1, 观测 section 会让高亮恒定落在上一栏。
  const { activeId, jumpTo } = useScrollSpy(
    items.map((i) => `section-${i.slug}`),
    { topOffset: measureStickyStack },
  );
  const activeSlug = activeId?.replace(/^section-/, "") ?? null;

  // 窄屏 chip 行放得下约三颗 chip(七方向的总宽度是可视宽度的两倍多), 高亮跑到行外
  // 就等于没有高亮 —— 跟随时把当前 chip 拉回行中。只动这一行自己的 scrollLeft:
  // 用 chip.scrollIntoView() 会连页面的纵向滚动一起改, 正好打断刚落位的锚点跳转。
  const chipRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = chipRowRef.current;
    if (!row || !activeSlug) return;
    const chip = row.querySelector<HTMLElement>(
      `[href="#section-${activeSlug}"]`,
    );
    if (!chip) return;
    // chip 的 offsetParent 是外层那个 sticky <nav>(它才是定位祖先), 不是这一行,
    // 所以 offsetLeft 里裹着 nav 的 px-4。减掉 row 自己的 offsetLeft 才是行内坐标
    // —— 直接拿 offsetLeft 跟 scrollLeft 比会整体偏 16px。
    const chipLeft = chip.offsetLeft - row.offsetLeft;
    // 已经完整看得见就别动。无条件居中等于每次高亮变化都启动一段平滑横滚, 而这段
    // 动画会把用户自己横滚 chip 行的手抢走(实测手动滚到 605 会被拽回 45)。
    const inView = chipLeft - row.scrollLeft;
    if (inView >= 0 && inView + chip.offsetWidth <= row.clientWidth) return;
    row.scrollTo({
      left: Math.max(0, chipLeft - (row.clientWidth - chip.offsetWidth) / 2),
      behavior: "smooth",
    });
  }, [activeSlug]);

  if (items.length === 0) return null;

  return (
    <>
      {/* 宽屏竖脊 */}
      <nav
        aria-label={m.edition_spine_label()}
        // 竖脊贴在 header 下方留 1rem 呼吸。lg 断点下 --edition-chip-h 已归零,
        // 所以 --edition-sticky-stack 在这里就等于 header 高度
        className="hidden lg:sticky lg:top-[calc(var(--edition-sticky-stack)_+_1rem)] lg:block lg:self-start"
      >
        {/* uppercase 与 module-kicker.tsx 保持一致是**刻意的**, 不是漏改。
            权衡的是这两件事:
            1) archive.tsx:104-106 声明过「CJK 下不用 uppercase/small-caps」并在那处照做了,
               按那条政策这里该去掉;
            2) 但 uppercase 对 CJK 是视觉空操作 —— 去掉它对中日读者看到的东西毫无改变,
               唯一真实的变化发生在英文侧: 这行会从 "IN THIS ISSUE" 变成 "In this issue",
               而同一页的 ModuleKicker 栏眉仍是大写, 于是英文界面上两个同级标签大小写打架。
            即: 去掉它换来的是文档一致, 付出的是英文可见的不一致。所以「栏眉到底大写不大写」
            要作为一个视觉决定一次性对全站做(那一步会同时把 "AI NEWS" 变成 "AI News",
            属于设计决策而非 bug 修复), 在那之前这里跟着 ModuleKicker 走。
            archive.tsx 那条声明与全站栏眉现状之间的落差是已知的, 与那个决定一起收。 */}
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-soft)]">
          {m.edition_spine_label()}
        </div>
        <ul className="list-none">
          {items.map((i) => {
            const active = i.slug === activeSlug;
            return (
              <li key={i.slug}>
                <a
                  href={`#section-${i.slug}`}
                  onClick={(e) => {
                    // 点击即设 active: 等 observer 回调会先高亮到别处再纠正
                    e.preventDefault();
                    jumpTo(`section-${i.slug}`);
                  }}
                  aria-current={active ? "location" : undefined}
                  className={cn(
                    "group flex items-baseline justify-between gap-2 py-1 text-xs no-underline",
                    active && "font-semibold",
                  )}
                  style={{
                    // 方向识别色在这一页只有两个落点, 这条 2px 左边线是其中之一
                    borderLeft: active
                      ? `2px solid ${i.accent}`
                      : "1px solid var(--line)",
                    // 1px→2px 的边宽差会让文字左右跳 1px, 用 padding 抵掉
                    paddingLeft: active ? "0.6875rem" : "0.75rem",
                  }}
                >
                  {/* 色挂内层 span 而不是 <a>: styles.css 那条未分层的
                      `a { color }` 会压过 Tailwind utilities 层, 写在 <a> 上的
                      text-* 全部失效(实测活跃项与非活跃项都会变成同一个棕色,
                      整条脊的层次消失)。同理 hover 走 group-hover。 */}
                  <span
                    className={cn(
                      "min-w-0 transition-colors",
                      active
                        ? "text-[var(--ink)]"
                        : "text-[var(--ink-soft)] group-hover:text-[var(--ink)]",
                    )}
                  >
                    {i.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-[var(--ink-soft)]">
                    {i.pickCount}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 space-y-1 pl-3 text-xs">
          {showPastAnchor ? (
            // 这两条要的就是全局 a{} 的 academic-brown, 不重复写色(写在 <a> 上
            // 反而是死类, 见 direction-section 里那段注释)
            <a
              href="#past-editions"
              className="block no-underline hover:underline"
            >
              {m.edition_past()}
            </a>
          ) : null}
          <Link
            to="/gallery/archive"
            activeOptions={{ exact: true }}
            className="block no-underline hover:underline"
          >
            {m.archive_title()}
          </Link>
        </div>
      </nav>

      {/* 窄屏吸顶 chip 行。比 header 低 1px 让接缝藏在 header 的下边框里(与
          gallery 两个列表页的筛选栏同一口径)。这一行的高度就是 --edition-chip-h,
          改了 py / 字号要连着改那个 token, 否则滚动跟随的判定带跟着错。 */}
      <nav
        aria-label={m.edition_spine_label()}
        className="sticky top-[calc(var(--header-h)_-_1px_+_env(safe-area-inset-top))] z-10 -mx-4 mb-5 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 py-2 backdrop-blur-md lg:hidden"
      >
        <div
          ref={chipRowRef}
          className="flex gap-2 overflow-x-auto text-[11px]"
        >
          {items.map((i) => {
            const active = i.slug === activeSlug;
            return (
              <a
                key={i.slug}
                href={`#section-${i.slug}`}
                onClick={(e) => {
                  e.preventDefault();
                  jumpTo(`section-${i.slug}`);
                }}
                aria-current={active ? "location" : undefined}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 no-underline transition-colors",
                  active
                    ? "border-[var(--academic-brown)] bg-[var(--academic-brown)]"
                    : "border-[var(--line)]",
                )}
              >
                {/* 同上: 选中态的 text-white 写在 <a> 上会被全局 a{color} 吃掉,
                    结果是棕底上的棕字 —— 实测整颗 chip 看起来是一块空色块 */}
                <span
                  className={active ? "text-white" : "text-[var(--ink-soft)]"}
                >
                  {i.name}
                </span>
              </a>
            );
          })}
        </div>
      </nav>
    </>
  );
}
