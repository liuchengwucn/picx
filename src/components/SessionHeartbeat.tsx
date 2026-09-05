import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useTRPC } from "#/integrations/trpc/react";
import { authClient } from "#/lib/auth-client";
import { getBeijingDateString } from "#/lib/beijing-date";
import {
  getReviewGuestClientSession,
  isReviewGuestModeEnabled,
  isReviewGuestReadOnlySession,
} from "#/lib/review-guest";

/**
 * 会话心跳：挂载 / 聚焦 / 回到前台时向 user.heartbeat 打一次，服务端负责盖
 * lastSeenAt 与静默领当日额度。同用户同北京日期只打一次——所以 lastSeenAt 的实际
 * 粒度是「每天首次打开」，服务端的一小时节流只是防御。
 *
 * 不弹任何 toast：签到奖励是实现细节，不是用户需要知道的概念。
 */
export default function SessionHeartbeat() {
  const { data: session } = authClient.useSession();
  const effectiveSession =
    session ??
    (isReviewGuestModeEnabled() ? getReviewGuestClientSession() : null);
  const isReadOnlyGuest = isReviewGuestReadOnlySession(effectiveSession);
  const userId = effectiveSession?.user?.id;
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const lastAttemptKeyRef = useRef<string | null>(null);

  const heartbeat = useMutation(
    trpc.user.heartbeat.mutationOptions({
      onSuccess: (result) => {
        if (!result.granted) return;
        // 额度变了，上传弹窗里的「还可生成 N 张」要跟上
        queryClient.invalidateQueries({
          queryKey: trpc.user.getProfile.queryKey(),
        });
      },
      onError: () => {
        lastAttemptKeyRef.current = null;
      },
    }),
  );

  // useMutation 每次渲染都返回新对象。若把它直接放进 maybeBeat 的依赖里，maybeBeat
  // 随之每次渲染都换新引用，下面的挂载 effect 就会跟着重跑；而 onError 里把
  // lastAttemptKeyRef 清空、报错本身又触发一次渲染 —— 持续失败（会话过期、用户行被删、
  // D1 不可用）就会连成一个只受请求延迟约束的重试死循环，还要乘以打开的标签页数。
  // 用 ref 持有 mutation、把依赖收窄到真正的身份，maybeBeat 才是稳定的；此时 onError
  // 的清空恢复成它本该的语义：这次失败允许在下一次 focus / visibilitychange 时重试，
  // 由用户操作天然限流。
  const heartbeatRef = useRef(heartbeat);
  heartbeatRef.current = heartbeat;

  const maybeBeat = useCallback(() => {
    if (isReadOnlyGuest || !userId || heartbeatRef.current.isPending) return;

    const attemptKey = `${userId}:${getBeijingDateString()}`;
    if (lastAttemptKeyRef.current === attemptKey) return;

    lastAttemptKeyRef.current = attemptKey;
    heartbeatRef.current.mutate();
  }, [userId, isReadOnlyGuest]);

  useEffect(() => {
    if (!userId || isReadOnlyGuest) {
      lastAttemptKeyRef.current = null;
      return;
    }
    maybeBeat();
  }, [userId, isReadOnlyGuest, maybeBeat]);

  useEffect(() => {
    if (!userId || isReadOnlyGuest) return;

    const handleFocus = () => maybeBeat();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") maybeBeat();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [userId, isReadOnlyGuest, maybeBeat]);

  return null;
}
