import { Skeleton } from "#/components/ui/skeleton";
import { cn } from "#/lib/utils";

/**
 * 登录态未确定期间（SSR 与客户端首帧）顶替聊天栏 / 原文面板的中性骨架。
 *
 * better-auth 的 session 在 SSR / 首帧拿不到（首帧登录态是竞态）：服务端只能按
 * 「未知」渲染，若直接当未登录出登录提示，已登录用户的客户端首帧会渲染出结构完全
 * 不同的子树 → React #418。骨架是两端都渲染的同一棵树，session 确定后（本组件
 * hydration 完成且 useSession 不再 pending）再分化成登录提示或真实面板。
 *
 * 纯占位：不含任何文字（无需 i18n），aria-hidden 对读屏隐藏。灰块用现成的
 * Skeleton（bg-accent 在明暗两套主题里都是羊皮纸系的中性色）。外壳（paper-card、
 * 内边距、高度）由调用方经 className 给，两个面板形状不同。
 */
export function PaperPanelSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-3", className)}>
      <Skeleton className="h-5 w-2/5" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-5/6" />
      {/* 面板被外壳撑到定高时（聊天栏），这块沉底充当输入区的影子；
          自然高度时（原文面板）mt-auto 解析为 0，就是一块内容占位 */}
      <Skeleton className="mt-auto h-16 w-full" />
    </div>
  );
}
