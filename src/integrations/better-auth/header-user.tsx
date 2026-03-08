import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "#/lib/auth-client";
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
      <div className="h-8 w-8 bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
    );
  }

  if (effectiveSession?.user) {
    return (
      <div className="flex items-center gap-2">
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
        {isGuestSession ? (
          <button
            type="button"
            onClick={() => {
              void authClient.signIn.social({
                provider: "github",
                callbackURL: "/",
              });
            }}
            className="h-9 px-3 sm:px-4 text-sm font-medium bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-50 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors inline-flex items-center whitespace-nowrap rounded"
          >
            <span className="hidden sm:inline">{m.auth_sign_in_github()}</span>
            <span className="sm:hidden">{m.auth_sign_in()}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={async () => {
              await authClient.signOut();
              queryClient.clear();
              window.location.assign("/");
            }}
            className="h-9 px-3 sm:px-4 text-sm font-medium bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-50 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors whitespace-nowrap rounded"
          >
            <span className="hidden sm:inline">{m.auth_sign_out()}</span>
            <span className="sm:hidden">{m.auth_sign_out_short()}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        void authClient.signIn.social({
          provider: "github",
          callbackURL: "/",
        });
      }}
      className="h-9 px-3 sm:px-4 text-sm font-medium bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-50 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors inline-flex items-center whitespace-nowrap rounded"
    >
      <span className="hidden sm:inline">{m.auth_sign_in_github()}</span>
      <span className="sm:hidden">{m.auth_sign_in()}</span>
    </button>
  );
}
