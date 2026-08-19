import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

export interface SpineItem {
  slug: string;
  name: string;
  pickCount: number;
  accent: string;
}

/**
 * 「本期一览」。这一页的签名元素: 7 个方向同时更新是这份周刊的真实结构, 脊把它
 * 常驻在视野里, 顺便回答「共几栏 / 你在第几栏 / 各栏几篇」——而不是装饰。
 *
 * 宽屏是 sticky 竖脊, 窄屏收成吸顶横向 chip 行(同一份数据, 两套排版)。
 *
 * 锚点用裸 <a href="#section-...">(不点 JS 也能跳)。注意 TanStack Router 会把
 * hash 变化当成一次导航并重跑本路由的 loader —— 挂载本组件的页面要么 loader 幂等,
 * 要么显式 `shouldReload: false`, 否则每点一次栏目名都要白跑一次数据加载。
 */
export function EditionSpine({
  items,
  showPastAnchor,
}: {
  items: SpineItem[];
  /** 页尾往期列表只在落地页出; 单期页没有那个锚点, 不能给一个跳不动的链接 */
  showPastAnchor?: boolean;
}) {
  const [activeSlug, setActiveSlug] = useState<string | null>(
    items[0]?.slug ?? null,
  );

  // 依赖 slug 串而不是 items 数组: 调用方每次渲染都会 map 出新数组, 直接依赖它会
  // 让 observer 白拆白建
  const slugKey = items.map((i) => i.slug).join(",");
  useEffect(() => {
    const slugs = slugKey ? slugKey.split(",") : [];
    const nodes = slugs
      .map((slug) => document.getElementById(`section-${slug}`))
      .filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;
    // 自己记全量可见态: 回调只带「这次发生变化」的 entries, 光看这一批取最靠上的
    // 那个会在快速滚动(多个 entry 同批、且顺序不保证)时高亮跳到读者身后的栏目。
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        // slugs 就是 DOM 顺序, 取第一个还落在判定带里的
        const first = slugs.find((slug) => visible.has(`section-${slug}`));
        // 全都不在带内(滚到刊头之上或页尾之下)时保留上一个高亮, 不闪回第一条
        if (first) setActiveSlug(first);
      },
      // 判定带 = 视口顶部往下一条窄带: 上边界收掉吸顶层的高度, 否则「进入视口」
      // 会在栏眉还被 header 盖住时就触发, 高亮跑在阅读位置前面; 下边界收掉大半
      // 屏, 否则一屏内同时可见的两三个栏目里最靠上那个会一直霸着高亮。
      { rootMargin: "-104px 0px -62% 0px" },
    );
    for (const n of nodes) observer.observe(n);
    return () => observer.disconnect();
  }, [slugKey]);

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
    row.scrollTo({
      left: Math.max(
        0,
        chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2,
      ),
      behavior: "smooth",
    });
  }, [activeSlug]);

  if (items.length === 0) return null;

  return (
    <>
      {/* 宽屏竖脊 */}
      <nav
        aria-label={m.edition_spine_label()}
        className="hidden lg:sticky lg:top-[calc(84px+env(safe-area-inset-top))] lg:block lg:self-start"
      >
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
                  aria-current={active ? "true" : undefined}
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

      {/* 窄屏吸顶 chip 行。sticky 偏移与全站 header 同口径(60/68px + safe-area) */}
      <nav
        aria-label={m.edition_spine_label()}
        className="sticky top-[calc(60px+env(safe-area-inset-top))] z-10 -mx-4 mb-5 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 py-2 backdrop-blur-md sm:top-[calc(68px+env(safe-area-inset-top))] lg:hidden"
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
                aria-current={active ? "true" : undefined}
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
