import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { authClient } from "#/lib/auth-client";
import {
  getReviewGuestClientSession,
  isReviewGuestModeEnabled,
  isReviewGuestReadOnlySession,
} from "#/lib/review-guest";
import { useTRPC } from "#/integrations/trpc/react";
import { getBeijingDateString } from "#/lib/beijing-date";
import { m } from "#/paraglide/messages";

export default function DailyBonusClaim() {
  const { data: session } = authClient.useSession();
  const effectiveSession =
    session ??
    (isReviewGuestModeEnabled() ? getReviewGuestClientSession() : null);
  const isReadOnlyGuest = isReviewGuestReadOnlySession(effectiveSession);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const lastAttemptKeyRef = useRef<string | null>(null);

  const claimDailyBonus = useMutation(
    trpc.user.claimDailyBonus.mutationOptions({
      onSuccess: (result) => {
        if (!result.granted) {
          return;
        }

        toast.success(m.daily_bonus_toast_title(), {
          description: m.daily_bonus_toast_desc(),
        });

        queryClient.invalidateQueries({
          queryKey: trpc.user.getProfile.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.user.getCreditHistory.queryKey({ page: 1, limit: 20 }),
        });
      },
      onError: () => {
        lastAttemptKeyRef.current = null;
      },
    }),
  );

  const maybeClaimDailyBonus = useCallback(() => {
    const userId = effectiveSession?.user?.id;
    if (isReadOnlyGuest) {
      return;
    }
    if (!userId || claimDailyBonus.isPending) {
      return;
    }

    const attemptKey = `${userId}:${getBeijingDateString()}`;
    if (lastAttemptKeyRef.current === attemptKey) {
      return;
    }

    lastAttemptKeyRef.current = attemptKey;
    claimDailyBonus.mutate();
  }, [claimDailyBonus, effectiveSession?.user?.id, isReadOnlyGuest]);

  useEffect(() => {
    if (!effectiveSession?.user?.id || isReadOnlyGuest) {
      lastAttemptKeyRef.current = null;
      return;
    }

    maybeClaimDailyBonus();
  }, [effectiveSession?.user?.id, isReadOnlyGuest, maybeClaimDailyBonus]);

  useEffect(() => {
    if (!effectiveSession?.user?.id || isReadOnlyGuest) {
      return;
    }

    const handleFocus = () => {
      maybeClaimDailyBonus();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        maybeClaimDailyBonus();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [effectiveSession?.user?.id, isReadOnlyGuest, maybeClaimDailyBonus]);

  return null;
}
