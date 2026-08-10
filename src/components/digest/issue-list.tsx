import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

interface IssueListProps {
  slug: string;
  issues: Array<{
    issueNumber: number;
    title: string;
    publishedAt: Date | null;
  }>;
}

/**
 * 往期简报列表(边栏用)。传进来的期次由调用方决定, 已发布倒序。
 * 期数会随周更累积, 这里不截断: 每一期都是一条可被爬到的内链, 藏起来只会让历史
 * 失去入口, 而边栏本身是可以长的。
 */
export function IssueList({ slug, issues }: IssueListProps) {
  const locale = getLocale();
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );
  if (issues.length === 0) return null;

  return (
    <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
      {issues.map((issue) => (
        <li key={issue.issueNumber}>
          <Link
            to="/gallery/d/$slug/$issue"
            params={{ slug, issue: String(issue.issueNumber) }}
            className="group block py-2.5 no-underline"
          >
            <span className="flex items-baseline gap-2 text-[11px] text-[var(--ink-soft)]">
              <span className="shrink-0 font-semibold tabular-nums text-[var(--academic-brown)]">
                {m.digest_issue_n({ n: String(issue.issueNumber) })}
              </span>
              {issue.publishedAt ? (
                <time dateTime={issue.publishedAt.toISOString()}>
                  {dateFormat.format(issue.publishedAt)}
                </time>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-sm text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown-deep)]">
              {issue.title}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
