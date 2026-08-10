import { createFileRoute } from "@tanstack/react-router";

// 占位路由: 只为让方向主页/往期列表的 <Link to="/gallery/d/$slug/$issue"> 在
// routeTree 里有落点。Task 6 会替换为完整实现(简报正文 SSR + DigestPaperCard +
// 上下期导航 + SEO meta), 这里刻意不做。
//
// 文件名的 `$slug_` 尾下划线是 TanStack Router 的「解除嵌套」语法: 简报页是独立
// 整页, 不渲染进方向主页的 Outlet。
export const Route = createFileRoute("/gallery/d/$slug_/$issue")({
  component: DigestIssuePagePlaceholder,
});

function DigestIssuePagePlaceholder() {
  const { slug, issue } = Route.useParams();
  return (
    <main className="min-h-screen bg-[var(--bg)] py-8">
      <div className="page-wrap">
        <h1 className="font-serif text-3xl font-bold text-[var(--ink)]">
          {slug} #{issue}
        </h1>
        <p className="mt-2 text-[var(--ink-soft)]">Coming soon</p>
      </div>
    </main>
  );
}
