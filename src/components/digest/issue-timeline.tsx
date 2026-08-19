import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

export interface TimelineIssue {
  issueNumber: number;
  title: string;
  excerpt: string;
  periodStart: Date;
  periodEnd: Date;
  pickCount: number;
}

/**
 * 方向的期次时间线, 取代旧版右边栏那份只有标题的往期列表。
 *
 * 每条带摘要而不是光秃秃的标题链接: 这一节是方向页「这个方向发生过什么」的答案,
 * 1 期时读得下去, 20 期时它就是这个方向的编年史。
 *
 * 宽屏分两栏 —— 左栏是账目(期号 / 覆盖周期 / 篇数, 等宽数字), 右栏是编辑内容
 * (标题 + 看点摘要)。这么切是为了让日期沿一列往下走: 15 期以后读者扫的是时间轴而
 * 不是一段段文字, 三项元信息横排在标题上方时那一列就断了。窄屏收回一行(flex-wrap),
 * 9rem 的左栏在 390px 上会把标题挤成两三个字一行。
 */
export function IssueTimeline({
  slug,
  issues,
}: {
  slug: string;
  issues: TimelineIssue[];
}) {
  const locale = getLocale();
  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        // 必须按 UTC 格化 —— 与刊头 / 页尾往期列表同一个理由: periodStart/periodEnd 是
        // UTC 的 00:00:00 / 23:59:59, 按本地时区渲染会让东八区读者看到的区间末日比
        // 这一期真正的永久链接(/gallery/w/<date>, 取的是 UTC 日)晚一天, 同一期于是
        // 出现两个日历。这个坑在本次重构里已经踩过三次, 别省这一行。
        timeZone: "UTC",
      }),
    [locale],
  );
  // 空态由调用方用 PendingPanel 表达(「首期简报生成中」), 这里不猜文案
  if (issues.length === 0) return null;

  return (
    <ul className="list-none divide-y divide-[var(--line)] border-t border-[var(--line)]">
      {issues.map((issue) => (
        <li key={issue.issueNumber}>
          {/* 整条可点: 编年史里读者要点的是「这一期」, 而不是标题那几个字 */}
          <Link
            to="/gallery/d/$slug/$issue"
            params={{ slug, issue: String(issue.issueNumber) }}
            // 指向别处的 Link 一律 exact: 默认前缀匹配会让 Link 给别处的目标挂上
            // aria-current="page"
            activeOptions={{ exact: true }}
            className="group grid gap-x-6 gap-y-1.5 py-4 no-underline sm:grid-cols-[9rem_minmax(0,1fr)]"
          >
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[11px] leading-relaxed text-[var(--ink-soft)] sm:flex-col sm:items-start">
              {/* 色一律挂内层元素而不是 <a> 自己: styles.css 里那条未分层的
                  `a { color }` 压过 Tailwind utilities 层, 写在 <a> 上的 text-* 是死类 */}
              <span className="font-semibold tabular-nums text-[var(--academic-brown)]">
                {m.digest_issue_n({ n: String(issue.issueNumber) })}
              </span>
              <time
                className="tabular-nums"
                dateTime={issue.periodEnd.toISOString()}
              >
                {fmt.formatRange(issue.periodStart, issue.periodEnd)}
              </time>
              <span className="tabular-nums">
                {m.direction_issue_picks({ n: String(issue.pickCount) })}
              </span>
            </div>
            {/* 62ch: 主列在宽屏近 1000px, 不封口的话摘要会拉成一行一百多字符 */}
            <div className="max-w-[62ch]">
              {/* 期标题用衬线 15px, 与页尾往期合刊目录同一号字 —— 两者是同一类对象
                  (一份可点进去的刊物索引), 别用两套排版 */}
              <h3 className="font-serif text-[15px] font-semibold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown-deep)]">
                {issue.title}
              </h3>
              {issue.excerpt ? (
                // clamp 2 行: 后端给的摘要最长 160 字符, 在 62ch 下约三行。15 期各三行
                // 是一面墙, 而这一节的职责是可扫 —— 要读全文点进去就是。
                <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-[var(--ink-soft)]">
                  {issue.excerpt}
                </p>
              ) : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
