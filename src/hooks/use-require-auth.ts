import { useEffect } from "react";
import { authClient } from "#/lib/auth-client";
import {
  getReviewGuestClientSession,
  isReviewGuestModeEnabled,
} from "#/lib/review-guest";

/**
 * Redirect to GitHub login if user is not authenticated
 * @param callbackURL - URL to redirect to after successful login
 */
export function useRequireAuth(callbackURL = "/papers") {
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();

  const guestSession =
    !session && isReviewGuestModeEnabled()
      ? getReviewGuestClientSession()
      : null;

  useEffect(() => {
    if (!isSessionPending && !session && !guestSession) {
      void authClient.signIn.social({
        provider: "github",
        callbackURL,
      });
    }
  }, [session, isSessionPending, guestSession, callbackURL]);

  return {
    session: session ?? guestSession,
    isSessionPending,
  };
}
