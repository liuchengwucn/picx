import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { ModuleKicker } from "#/components/home/module-kicker";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

export interface EditionPeriodItem {
  period: string;
  periodStart: Date;
  periodEnd: Date;
  directionCount: number;
  pickCount: number;
}

/**
 * 页尾往期合刊列表 = 刊末的索引页。每一期的「名字」就是它覆盖的那段日期, 所以这里
 * 的日期区间用衬线(与刊头把历史期的 h1 设成日期区间是同一个决定): 同一个对象, 小
 * 一号。右侧那组数字用等宽数字右对齐, 整块读起来是一张目录表而不是一串卡片。
 *
 * **不截断**: 每一期都是一条可被爬到的内链, 折叠起来只会让历史失去入口。真实规模
 * 是一年 52 条, 一张目录表放得下。
 *
 * 栏眉的方块走 --ink-soft 而不是某个方向识别色: 这一节不属于任何方向, 借一个方向色
 * 会让「颜色 = 方向身份」这条约定破功。
 */
export function PastEditions({
  editions,
  currentPeriod,
}: {
  editions: EditionPeriodItem[];
  /** 本期(正文已经是它了)从列表里剔掉, 否则页尾第一条就是「跳到你正在看的这一页」 */
  currentPeriod: string;
}) {
  const locale = getLocale();
  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        // 必须按 UTC 格化 —— 与刊头同一个理由: 周期边界是 UTC 日, 按本地时区渲染
        // 会让东八区读者看到的区间与它自己指向的 /gallery/w/2026-08-15 差一天。
        timeZone: "UTC",
      }),
    [locale],
  );
  const past = editions.filter((e) => e.period !== currentPeriod);

  return (
    // id 是竖脊末尾「往期合刊」的锚点; scroll-mt 读的是与栏目同一个吸顶栈 token,
    // 别在这里写裸魔数(那个 token 含 safe-area 与断点分支, 手抄必然漂)。
    // biome-ignore lint/correctness/useUniqueElementIds: 固定 id 正是目的 —— 它是竖脊 <a href="#past-editions"> 的跳转目标, 一页只出现一次(落地页页尾)
    <section
      id="past-editions"
      className="mt-14 scroll-mt-[calc(var(--edition-sticky-stack)_+_0.5rem)]"
    >
      {past.length > 0 ? (
        <>
          <ModuleKicker as="h2" color="var(--ink-soft)">
            {m.edition_past()}
          </ModuleKicker>
          {/* ol 而不是 ul: 倒序的时间本身带信息 */}
          <ol className="mt-2 list-none">
            {past.map((e) => (
              <li key={e.period} className="border-t border-[var(--line)]">
                <Link
                  to="/gallery/w/$period"
                  params={{ period: e.period }}
                  activeOptions={{ exact: true }}
                  className="group flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 no-underline"
                >
                  {/* 色一律挂内层 span: 全局 `a { color }` 是未分层规则, 会吃掉写在
                      <a> 上的 text-*(整列日期会变成同一个棕色) */}
                  <span className="font-serif text-[15px] font-semibold text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown-deep)]">
                    {fmt.formatRange(e.periodStart, e.periodEnd)}
                  </span>
                  <span className="text-xs tabular-nums text-[var(--ink-soft)]">
                    {m.edition_meta_all({
                      directions: String(e.directionCount),
                      picks: String(e.pickCount),
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {/* 档案入口无条件出: 窄屏的吸顶 chip 行只有方向 chips(脊上那两条链接是宽屏
          专属), 所以这是移动端从合刊走进全站 900+ 篇论文的唯一入口。上面那条
          border-t 同时是目录表的收口线。 */}
      <div className="border-t border-[var(--line)] pt-3">
        <Link
          to="/gallery/archive"
          activeOptions={{ exact: true }}
          className="group inline-flex items-center gap-1 text-[11px] font-semibold no-underline"
        >
          {m.archive_title()}
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            strokeWidth={1.25}
            aria-hidden
          />
        </Link>
      </div>
    </section>
  );
}
