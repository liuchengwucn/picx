import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Clipboard, Coins, Key } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useHydrated } from "#/hooks/use-hydrated";
import { authClient, startGitHubSignIn } from "#/lib/auth-client";
import {
  getReviewGuestClientSession,
  isReviewGuestModeEnabled,
} from "#/lib/review-guest";
import * as m from "#/paraglide/messages";

export default function BetterAuthHeader() {
  const queryClient = useQueryClient();
  const { data: session, isPending: sessionPending } = authClient.useSession();
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
  const guestSession =
    !session && isReviewGuestModeEnabled()
      ? getReviewGuestClientSession()
      : null;
  const effectiveSession = session ?? guestSession;
  const isGuestSession = !session && !!guestSession;

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
          {isGuestSession ? (
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
                <Link to="/credits" className="flex items-center gap-2">
                  <Coins className="h-4 w-4" />
                  {m.nav_credits()}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/api-configs" className="flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  {m.nav_api_configs()}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  to="/whiteboard-prompts"
                  className="flex items-center gap-2"
                >
                  <Clipboard className="h-4 w-4" />
                  {m.nav_whiteboard_prompts()}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  await authClient.signOut();
                  queryClient.clear();
                  window.location.assign("/");
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
