import { useMemo } from "react";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

/**
 * 论文原文的发表年月, 单期页的 picks 卡与合刊栏目的 picks 条目共用。
 *
 * 入参是 "YYYY-MM" 这个机器值而不是 Date: 服务端与客户端拿到同一个字符串、走同一次
 * 格化, 才不会因为两侧时区不同渲染出不同文本(hydration 不匹配)。timeZone 必须显式
 * 写 UTC —— 月首零点按东八区渲染会掉到上个月的最后一天, 于是「2026-05」在读者屏幕
 * 上变成 2026 年 4 月。
 *
 * 月份用 month:"long" 而不是 "short": 英文缩写在不同 ICU 版本里不一致(Sep / Sept),
 * SSR 的 workerd 与浏览器各用各的 ICU, 缩写正是会漂的那一档。
 *
 * 值来自 arXiv id 的 YYMM 段(papers.published_at 是本站上架时间, 不是原文发表时间),
 * 解析不出就是 null —— 一律不渲染, 不猜、不退化成上架时间。
 */
export function PublishedMonth({
  value,
  className,
}: {
  value: string | null;
  className?: string;
}) {
  const locale = getLocale();
  const label = useMemo(() => {
    if (!value) return null;
    const date = new Date(`${value}-01T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(date);
  }, [locale, value]);

  if (!label || !value) return null;
  return (
    <time dateTime={value} className={className}>
      {/* 读屏里一个孤零零的年月说不清是什么日期(投稿? 入选? 上架?) */}
      <span className="sr-only">{`${m.digest_paper_published()} `}</span>
      {label}
    </time>
  );
}
