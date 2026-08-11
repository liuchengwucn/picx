import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type RecentPaper, readRecentPapers } from "#/lib/recent-papers";
import { formatRelative } from "#/lib/relative-time";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

/**
 * 「最近打开」三张小卡。数据只在 localStorage 里,所以首帧读不到 ——
 * 未就绪时整块不渲染(不留占位空洞),客户端读到后再撑开。
 * /papers 是登录后才渲染的客户端页面,这一次高度变化可接受。
 */
export function RecentPapers() {
  const [recent, setRecent] = useState<RecentPaper[] | null>(null);
  const locale = getLocale();

  useEffect(() => {
    setRecent(readRecentPapers());
  }, []);

  if (!recent || recent.length === 0) return null;

  return (
    <section className="mt-5">
      <h2 className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--academic-brown)] after:h-px after:flex-1 after:bg-[var(--line)] after:content-['']">
        {m.papers_recent_opened()}
      </h2>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {recent.map((paper) => (
          <Link
            key={paper.shortId}
            to="/p/$shortId"
            params={{ shortId: paper.shortId }}
            className="group rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 no-underline transition-colors hover:border-[var(--academic-brown)]"
          >
            <span className="line-clamp-2 font-serif text-xs font-semibold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)]">
              {paper.title}
            </span>
            <span className="mt-1 block text-[10px] text-[var(--ink-soft)]">
              {formatRelative(paper.openedAt, Date.now(), locale)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
