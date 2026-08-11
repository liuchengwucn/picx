// 每方向最近 10 期的状态总览。这是排障用的读屏：期号、状态、周期、发布时间，
// 外加 workflowInstanceId —— 最后一项是去 Cloudflare 控制台捞 Workflow 实例的钥匙，
// 所以给它 mono + select-all，让站长一次划中整串。
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useMemo } from "react";
import { AdminEmpty, AdminSection, Pill } from "#/components/admin/admin-ui";
import { Skeleton } from "#/components/ui/skeleton";
import { useTRPC } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

type AdminDigestRow =
  inferRouterOutputs<TRPCRouter>["admin"]["listRecentDigests"][number];

const STATUS_TONE = {
  generating: "warn",
  published: "ok",
  failed: "bad",
} as const;

function statusLabel(status: AdminDigestRow["status"]): string {
  if (status === "published") return m.admin_status_published();
  if (status === "failed") return m.admin_status_failed();
  return m.admin_status_generating();
}

export function DigestStatusPanel() {
  const trpc = useTRPC();
  const locale = getLocale();
  const digestsQuery = useQuery(trpc.admin.listRecentDigests.queryOptions());
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );

  // 后端已按 sortOrder/slug、期号倒序给好；这里只按方向切段，不再排序
  const groups = useMemo(() => {
    const bySlug = new Map<string, AdminDigestRow[]>();
    for (const row of digestsQuery.data ?? []) {
      const list = bySlug.get(row.directionSlug);
      if (list) list.push(row);
      else bySlug.set(row.directionSlug, [row]);
    }
    return [...bySlug.entries()];
  }, [digestsQuery.data]);

  return (
    <AdminSection anchorId="issues" title={m.admin_section_issues()}>
      {digestsQuery.isPending ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : digestsQuery.isError ? (
        <p className="py-6 text-sm font-medium text-[var(--sienna)]">
          {m.admin_error_generic()}
        </p>
      ) : groups.length === 0 ? (
        <AdminEmpty>{m.admin_no_issues()}</AdminEmpty>
      ) : (
        <div className="space-y-6">
          {groups.map(([slug, rows]) => (
            <div key={slug} data-testid="admin-digest-group" data-slug={slug}>
              <h3 className="font-mono text-xs text-[var(--academic-brown-deep)]">
                {slug}
              </h3>
              <ul className="mt-2 divide-y divide-[var(--line)] border-t border-[var(--line)]">
                {rows.map((row) => (
                  <li
                    key={row.digestId}
                    data-testid="admin-digest-row"
                    className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2"
                  >
                    <span className="w-24 shrink-0 font-mono text-xs text-[var(--ink)] tabular-nums">
                      {m.admin_issue_number({ n: String(row.issueNumber) })}
                    </span>
                    <Pill tone={STATUS_TONE[row.status]}>
                      {statusLabel(row.status)}
                    </Pill>
                    <span className="text-xs text-[var(--ink-soft)] tabular-nums">
                      {dateFormat.format(row.periodStart)} –{" "}
                      {dateFormat.format(row.periodEnd)}
                    </span>
                    {row.publishedAt ? (
                      <time
                        dateTime={row.publishedAt.toISOString()}
                        className="text-xs text-[var(--ink-soft)] tabular-nums"
                      >
                        {dateFormat.format(row.publishedAt)}
                      </time>
                    ) : null}
                    <code className="ml-auto max-w-full truncate font-mono text-[0.7rem] text-[var(--ink-soft)] select-all">
                      {row.workflowInstanceId}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </AdminSection>
  );
}
