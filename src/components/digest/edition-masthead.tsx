import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ModuleKicker } from "#/components/home/module-kicker";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

/**
 * 合刊刊头。右侧那组元信息是纯文本, 不给底色不描边 —— 「dateline 信息带」是被
 * 否决过的做法(红线)。标题下那条 2px 实线是刊物分隔, 不是装饰。
 */
export function EditionMasthead({
  period,
  periodStart,
  periodEnd,
  isLatest,
  activeDirectionCount,
  updatedDirectionCount,
  pickCount,
}: {
  period: string;
  periodStart: Date;
  periodEnd: Date;
  isLatest: boolean;
  activeDirectionCount: number;
  updatedDirectionCount: number;
  pickCount: number;
}) {
  const locale = getLocale();
  const range = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        // 必须按 UTC 格化: 周期边界是 UTC 的 00:00:00 / 23:59:59, period 也是
        // date(period_end, 'unixepoch') 取的 UTC 日。按本地时区渲染会让东八区
        // 的读者看到「8/9 – 8/16」而永久链接写着 2026-08-15, 同一期出现两个日历。
        timeZone: "UTC",
      }).formatRange(periodStart, periodEnd),
    [locale, periodStart, periodEnd],
  );

  return (
    <header className="border-b-2 border-[var(--ink)] pb-2">
      <ModuleKicker as="div" color="var(--academic-brown)">
        {m.edition_kicker()}
      </ModuleKicker>
      {/* 窄屏必须竖着堆: 右侧那组元信息最长一行(「9 个方向 · 本期 7 个有更新 ·
          48 篇入选」)在 375px 上放不进 h1 旁边剩下的宽度, flex-wrap 也救不了
          ——它整块塞得进去, 只是自己的文字溢出容器右缘被切掉(实测切掉了「入选」)。 */}
      <div className="mt-1.5 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-x-4">
        <h1 className="font-serif text-3xl font-bold leading-none text-[var(--ink)] sm:text-4xl">
          {isLatest ? m.edition_this_week() : range}
        </h1>
        <div className="text-xs leading-relaxed text-[var(--ink-soft)] sm:text-right">
          {/* 历史期的 h1 本身就是日期区间, 再写一遍是重复; 「本周」才需要它说清是哪一周 */}
          {isLatest ? <div>{range}</div> : null}
          <div>
            {updatedDirectionCount === activeDirectionCount
              ? m.edition_meta_all({
                  directions: String(activeDirectionCount),
                  picks: String(pickCount),
                })
              : m.edition_meta_partial({
                  directions: String(activeDirectionCount),
                  updated: String(updatedDirectionCount),
                  picks: String(pickCount),
                })}
          </div>
          {/* 「本期」这个 URL 每周会换内容, 所以明写一条稳定链接给人引用。历史期
              自己就是那条稳定链接(读者已经在它上面了), 不必重复。 */}
          {isLatest ? (
            <Link
              to="/gallery/w/$period"
              params={{ period }}
              // 指向别处的 Link 一律 exact: 默认前缀匹配会把它在本页判成 active,
              // 于是给一个指向别处的链接挂上 aria-current="page"
              activeOptions={{ exact: true }}
              className="no-underline hover:underline"
            >
              {m.edition_permalink({ period })}
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
