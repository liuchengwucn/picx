// 站长专用的方向管理台。全站唯一一个 admin 页面，不挂进任何导航，也不进索引。
//
// 权限判定完全押在 whoami 这一次 adminProcedure 调用上：能调通就是 admin，
// 401/403 一律渲染 404 文案而不是「无权限」—— 后者等于向随手一试的人确认
// 「这个地址存在、只是你不够格」，白送一个探测面。页面壳本身不含任何数据，
// 四个面板各自的查询也全走 adminProcedure，没有前端把关这一说。
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DigestStatusPanel } from "#/components/admin/digest-status-panel";
import { DirectionPanel } from "#/components/admin/direction-panel";
import { FeedbackPanel } from "#/components/admin/feedback-panel";
import { ProposalPanel } from "#/components/admin/proposal-panel";
import { Skeleton } from "#/components/ui/skeleton";
import { useRequireAuth } from "#/hooks/use-require-auth";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/admin/directions")({
  component: AdminDirectionsPage,
  head: () => ({
    meta: [{ title: m.admin_title() }, { name: "robots", content: "noindex" }],
  }),
});

const SECTION_LINKS = [
  { id: "directions", label: () => m.admin_section_directions() },
  { id: "proposals", label: () => m.admin_section_proposals() },
  { id: "issues", label: () => m.admin_section_issues() },
  { id: "feedback", label: () => m.admin_section_feedback() },
];

function AdminDirectionsPage() {
  const trpc = useTRPC();
  const { session, isSessionPending } = useRequireAuth("/admin/directions");

  const whoami = useQuery({
    ...trpc.admin.whoami.queryOptions(),
    enabled: Boolean(session),
    // FORBIDDEN 重试三次既拖慢 404 帧，又把「不是 admin」这件事重复问三遍
    retry: false,
  });

  if (isSessionPending || (session && whoami.isPending)) {
    return (
      <main className="page-wrap py-10">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="mt-6 h-48 rounded-xl" />
      </main>
    );
  }

  // 未登录时 useRequireAuth 已经在跳 GitHub 了，这只是跳转前的一帧
  if (!session || whoami.isError) {
    return (
      <main className="page-wrap py-24 text-center">
        <h1 className="font-serif text-2xl font-bold text-[var(--ink)]">
          {m.admin_forbidden_title()}
        </h1>
      </main>
    );
  }

  return (
    <main className="page-wrap py-10">
      <header className="border-b border-[var(--line)] pb-4">
        <h1 className="font-serif text-3xl font-bold text-[var(--ink)]">
          {m.admin_title()}
        </h1>
        <nav className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
          {SECTION_LINKS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="text-xs text-[var(--ink-soft)] underline-offset-4 hover:text-[var(--academic-brown-deep)] hover:underline"
            >
              {section.label()}
            </a>
          ))}
        </nav>
      </header>

      <div className="mt-10">
        <DirectionPanel />
        <ProposalPanel />
        <DigestStatusPanel />
        <FeedbackPanel />
      </div>
    </main>
  );
}
