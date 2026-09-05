import { useEffect } from "react";
import { startGitHubSignIn } from "#/lib/auth-client";
import { useEffectiveSession } from "./use-effective-session";

/**
 * Redirect to GitHub login if user is not authenticated
 * @param callbackURL - URL to redirect to after successful login
 */
export function useRequireAuth(callbackURL = "/papers") {
  const { session, isPending } = useEffectiveSession();

  useEffect(() => {
    if (!isPending && !session) {
      void startGitHubSignIn(callbackURL);
    }
  }, [session, isPending, callbackURL]);

  return { session, isSessionPending: isPending };
}
