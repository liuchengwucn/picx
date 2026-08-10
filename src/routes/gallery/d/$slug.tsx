import { createFileRoute } from "@tanstack/react-router";

// 占位路由: 只为让方向 tab 的 <Link to="/gallery/d/$slug"> 在 routeTree 里有落点。
// Task 5 会替换为完整实现(方向主页: 最新一期大卡 + 论文流 + 边栏), 连 SEO meta /
// loader / 布局 / i18n 一起补, 这里刻意不做。
export const Route = createFileRoute("/gallery/d/$slug")({
  component: DirectionPagePlaceholder,
});

function DirectionPagePlaceholder() {
  const { slug } = Route.useParams();
  return (
    <main className="min-h-screen bg-[var(--bg)] py-8">
      <div className="page-wrap">
        <h1 className="font-serif text-3xl font-bold text-[var(--ink)]">
          {slug}
        </h1>
        <p className="mt-2 text-[var(--ink-soft)]">Coming soon</p>
      </div>
    </main>
  );
}
