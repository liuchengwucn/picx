// 全站最近 50 条论文反馈。这一节没有任何操作，纯粹是口味信号的旁听席：
// 站长改 focusBrief 之前先看这里踩票在骂什么。
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useMemo } from "react";
import { AdminEmpty, AdminSection } from "#/components/admin/admin-ui";
import { Skeleton } from "#/components/ui/skeleton";
import { useTRPC } from "#/integrations/trpc/react";
// 文案表与踩票 chip 同源（枚举加成员时那份带枚举键的 Record 会编译报错）
import { feedbackReasonLabel } from "#/lib/feedback-reasons";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

export function FeedbackPanel() {
  const trpc = useTRPC();
  const locale = getLocale();
  const feedbackQuery = useQuery(trpc.admin.listRecentFeedback.queryOptions());
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "short" }),
    [locale],
  );

  return (
    <AdminSection
      anchorId="feedback"
      title={m.admin_section_feedback()}
      count={feedbackQuery.data?.length}
    >
      {feedbackQuery.isPending ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : feedbackQuery.isError ? (
        <p className="py-6 text-sm font-medium text-[var(--sienna)]">
          {m.admin_error_generic()}
        </p>
      ) : feedbackQuery.data.length === 0 ? (
        <AdminEmpty>{m.admin_no_feedback()}</AdminEmpty>
      ) : (
        <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
          {feedbackQuery.data.map((row) => {
            const reason = row.reasonPreset
              ? feedbackReasonLabel(row.reasonPreset)
              : null;
            return (
              // 一个用户对一篇论文只有一行（paper_feedback 的唯一键），所以
              // paperShortId + userId 就是稳定身份；带上 updatedAt 会让每次改票
              // 都换 key、整行重挂
              <li
                key={`${row.paperShortId}-${row.userId}`}
                data-testid="admin-feedback-row"
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5"
              >
                {row.vote > 0 ? (
                  <ThumbsUp
                    aria-label={m.feedback_like()}
                    className="size-3.5 shrink-0 self-center text-[var(--olive)]"
                  />
                ) : (
                  <ThumbsDown
                    aria-label={m.feedback_dislike()}
                    className="size-3.5 shrink-0 self-center text-[var(--sienna)]"
                  />
                )}
                <Link
                  to="/p/$shortId"
                  params={{ shortId: row.paperShortId }}
                  className="min-w-0 max-w-full flex-1 truncate text-sm text-[var(--ink)] underline-offset-2 hover:underline"
                >
                  {row.paperTitle}
                </Link>
                {reason ? (
                  <span className="shrink-0 text-xs text-[var(--academic-brown-deep)]">
                    {reason}
                  </span>
                ) : null}
                {row.reasonText ? (
                  <span className="min-w-0 basis-full truncate text-xs text-[var(--ink-soft)] italic sm:basis-auto">
                    “{row.reasonText}”
                  </span>
                ) : null}
                <span className="shrink-0 text-xs text-[var(--ink-soft)]">
                  {row.userName}
                </span>
                <time
                  dateTime={row.updatedAt.toISOString()}
                  className="shrink-0 text-xs text-[var(--ink-soft)] tabular-nums"
                >
                  {dateFormat.format(row.updatedAt)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </AdminSection>
  );
}
