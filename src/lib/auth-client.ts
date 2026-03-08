import { createAuthClient } from "better-auth/react";

// 在浏览器环境中，baseURL 应该指向当前域名
// 开发环境下默认是 http://localhost:3000
export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
});

const GITHUB_SIGN_IN_DEBOUNCE_MS = 5000;

let isGitHubSignInInProgress = false;
let lastGitHubSignInStartedAt = 0;

export async function startGitHubSignIn(callbackURL = "/") {
  const now = Date.now();

  if (
    isGitHubSignInInProgress &&
    now - lastGitHubSignInStartedAt < GITHUB_SIGN_IN_DEBOUNCE_MS
  ) {
    return;
  }

  isGitHubSignInInProgress = true;
  lastGitHubSignInStartedAt = now;

  try {
    await authClient.signIn.social({
      provider: "github",
      callbackURL,
    });
  } catch (error) {
    isGitHubSignInInProgress = false;
    lastGitHubSignInStartedAt = 0;
    throw error;
  }
}
