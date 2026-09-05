import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { toast } from "sonner";
import { m } from "#/paraglide/messages";

// 在浏览器环境中，baseURL 应该指向当前域名
// 开发环境下默认是 http://localhost:3000
export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:3000",
  plugins: [adminClient()],
});

const GITHUB_SIGN_IN_DEBOUNCE_MS = 5000;

let isGitHubSignInInProgress = false;
let lastGitHubSignInStartedAt = 0;

/**
 * 失败复位 + 提示。成功路径不复位是故意的: 成功意味着整页就要跳去 GitHub, 这个模块
 * 连同这两个变量都会被卸载, 而在跳转真正发生前的那几百毫秒里, 防连点恰恰还得生效。
 */
function failGitHubSignIn() {
  isGitHubSignInInProgress = false;
  lastGitHubSignInStartedAt = 0;
  toast.error(m.auth_sign_in_failed());
}

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

  // 两条失败路径都要接, 少任何一条都会漏。better-auth 的 react client 默认
  // throw: false —— HTTP 失败(实测: 端口与 BETTER_AUTH_URL 对不上时的
  // 403 INVALID_ORIGIN)走的是**返回 { error }**, 一个字节的异常都不抛, 只加
  // try/catch 是抓不到的; 而 catch 仍要留着, 网络层断掉时它才是唯一的出口。
  try {
    const { error } = await authClient.signIn.social({
      provider: "github",
      callbackURL,
    });
    if (error) failGitHubSignIn();
  } catch {
    failGitHubSignIn();
  }
  // 不 rethrow: 全部 6 个调用点都是 void startGitHubSignIn(...), 往上抛只会变成
  // 无人处理的 promise rejection —— 用户看到的还是「什么都没发生」, 反倒多一条噪音。
  // 提示已经在 failGitHubSignIn 里给了, 错误到此为止。
}

/**
 * 退出并把整份 query 缓存清掉再整页回首页。头像菜单和设置页共用：两处退出必须
 * 做同样的三件事，否则一处漏 clear 会把上一个人的数据留给下一个登录者看。
 *
 * 必须查 { error }：better-auth 的 react 客户端默认 throw:false，HTTP 失败是
 * **返回** error 而不是抛（见上面 startGitHubSignIn 的注释，403 INVALID_ORIGIN
 * 就是这么来的）。不查就会在退出失败时照样清缓存并跳首页——用户看到一个「已退出」
 * 的界面，而会话 cookie 还活着，下一次导航又被静默登了回去。共用机器上这是真问题。
 *
 * 参数收成结构类型而不是 QueryClient，是为了不把 @tanstack/react-query 拖进
 * auth-client 的依赖里（它被登录前的代码路径引用）。
 */
export async function signOutAndReset(queryClient: {
  clear: () => void;
}): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) {
    toast.error(m.auth_sign_out_failed());
    return;
  }
  queryClient.clear();
  window.location.assign("/");
}
