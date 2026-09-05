import { authClient } from "#/lib/auth-client";
import {
  getReviewGuestClientSession,
  isReviewGuestModeEnabled,
  isReviewGuestReadOnlySession,
} from "#/lib/review-guest";

/**
 * 真实 session，没有时退到审阅访客合成 session（若启用）。
 *
 * 「session ?? guest」这段推导原先在 header-user、use-require-auth 里各有一份，
 * 设置页还要再来一份；收敛到这里，那两处改为消费本 hook（use-require-auth 是本
 * hook 的严格超集：同样的推导 + 一个跳登录的 effect）。
 *
 * isGuest 与 isReadOnly 是两件事：isGuest 问「这是不是合成会话」（决定该显示
 * 「退出登录」还是「去登录」），isReadOnly 问「能不能写」（合成会话且未开放写入）。
 * 拿 isReadOnly 当 isGuest 用会在开放写入的审阅环境里露出一个点不动的退出按钮。
 */
export function useEffectiveSession() {
  const { data: session, isPending } = authClient.useSession();
  const guestSession =
    !session && isReviewGuestModeEnabled()
      ? getReviewGuestClientSession()
      : null;
  const effectiveSession = session ?? guestSession;
  return {
    session: effectiveSession,
    isPending,
    isGuest: !session && !!guestSession,
    isReadOnly: isReviewGuestReadOnlySession(effectiveSession),
  };
}
