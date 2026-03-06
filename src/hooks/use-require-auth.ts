import { useEffect } from "react";
import { authClient } from "#/lib/auth-client";

/**
 * Redirect to GitHub login if user is not authenticated
 * @param callbackURL - URL to redirect to after successful login
 */
export function useRequireAuth(callbackURL = "/papers") {
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();

  useEffect(() => {
    if (!isSessionPending && !session) {
      void authClient.signIn.social({
        provider: "github",
        callbackURL,
      });
    }
  }, [session, isSessionPending, callbackURL]);

  return { session, isSessionPending };
}
