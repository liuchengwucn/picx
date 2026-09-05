import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useEffectiveSession } from "#/hooks/use-effective-session";
import { useHydrated } from "#/hooks/use-hydrated";
import { signOutAndReset, startGitHubSignIn } from "#/lib/auth-client";
import * as m from "#/paraglide/messages";

export default function BetterAuthHeader() {
  const queryClient = useQueryClient();
  const {
    session: effectiveSession,
    isPending: sessionPending,
    isGuest,
  } = useEffectiveSession();
  const hydrated = useHydrated();
  /**
   * 首帧一律按 pending 渲染: 服务端渲染时 session fetch 根本不跑(客户端才发),
   * 所以 SSR 那帧永远是下面那个骨架。而 session fetch 有可能在 hydration 走到这里
   * 之前就落地(竞态), 那时客户端首帧会渲染 <button> 或头像 —— 与服务端的 <div>
   * 骨架**结构**不一致, React 报 #418 并丢弃整棵 SSR 子树重渲。这一条在全站每个
   * 页面都活着, 而且它在树里位置靠前, 会先触发、把下游别的 mismatch 一起掩盖掉。
   *
   * 翻牌不会给已登录用户闪一下登录按钮: 是从骨架翻到真实状态, 不经过 signed-out 分支。
   */
  const isPending = !hydrated || sessionPending;

  if (isPending) {
    return (
      <div className="h-8 w-8 bg-neutral-100 dark:bg-neutral-800 animate-pulse rounded-full" />
    );
  }

  if (effectiveSession?.user) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="h-8 w-8 rounded-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            {effectiveSession.user.image ? (
              <img
                src={effectiveSession.user.image}
                alt=""
                className="h-8 w-8 rounded-full"
              />
            ) : (
              <div className="h-8 w-8 bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center rounded-full">
                <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
                  {effectiveSession.user.name?.charAt(0).toUpperCase() || "U"}
                </span>
              </div>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isGuest ? (
            <DropdownMenuItem
              onClick={() => {
                void startGitHubSignIn("/");
              }}
            >
              {m.auth_sign_in_github()}
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem asChild>
                <Link to="/settings" className="flex items-center gap-2">
                  <Settings className="h-4 w-4" strokeWidth={1.25} />
                  {m.nav_settings()}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  void signOutAndReset(queryClient);
                }}
              >
                {m.auth_sign_out()}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        void startGitHubSignIn("/");
      }}
      className="h-9 px-3 sm:px-4 text-sm font-medium bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-50 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors inline-flex items-center whitespace-nowrap rounded"
    >
      <span className="hidden sm:inline">{m.auth_sign_in_github()}</span>
      <span className="sm:hidden">{m.auth_sign_in()}</span>
    </button>
  );
}
