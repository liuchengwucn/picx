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
import { authClient, startGitHubSignIn } from "#/lib/auth-client";
import {
  getReviewGuestClientSession,
  isReviewGuestModeEnabled,
} from "#/lib/review-guest";
import * as m from "#/paraglide/messages";

export default function BetterAuthHeader() {
  const queryClient = useQueryClient();
  const { data: session, isPending } = authClient.useSession();
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
