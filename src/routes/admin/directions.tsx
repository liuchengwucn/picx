// 站长专用的方向管理台。全站唯一一个 admin 页面，不挂进任何导航，也不进索引。
//
// 权限判定完全押在 whoami 这一次 adminProcedure 调用上：能调通就是 admin，
// 401/403 一律渲染 404 文案而不是「无权限」，免得向已登录的非站长确认「这个地址
// 存在、只是你不够格」。
//
// 这层伪装的覆盖范围仅止于此：匿名访客会先命中 useRequireAuth 被弹去 GitHub OAuth，
// 那次成功的重定向本身就说明这个地址存在，所以「地址存在」对匿名探测者并不隐藏
// （唯一的例外是 review-guest 构建：那边 useRequireAuth 给匿名访客发一个合成会话、
// 不再重定向，于是 whoami 403、404 伪装反而对匿名访客也生效）。
// 仍保留 useRequireAuth 是为了站长自己没登录时有登录入口（否则只会看到 404）；
// 至于随手一试的爬虫，由 head() 的 noindex 与 robots.txt 的 Disallow: /admin 拦。
//
// 页面壳本身不含任何数据，四个面板各自的查询也全走 adminProcedure，没有前端把关这一说。
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
    /**
     * 「不是 admin」与「这一次没连上」要分开处理：
     * - FORBIDDEN / UNAUTHORIZED 是终局答案，重试三次只是把它重复问三遍，还拖慢
     *   那一帧 404 的出现；
     * - 其余（网络抖动、Worker 冷启动超时）一次失败就把管理台永久变成「页面不存在」
     *   太脆了，给两次重试。
     */
    retry: (failureCount, error) => {
      const code = (error as { data?: { code?: string } }).data?.code;
      if (code === "FORBIDDEN" || code === "UNAUTHORIZED") return false;
      return failureCount < 2;
    },
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
