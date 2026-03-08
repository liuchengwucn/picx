import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { authClient } from "#/lib/auth-client";
import { useTRPC } from "#/integrations/trpc/react";
import { getBeijingDateString } from "#/lib/beijing-date";
import { m } from "#/paraglide/messages";

export default function DailyBonusClaim() {
  const { data: session } = authClient.useSession();
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
    const userId = session?.user?.id;
    if (!userId || claimDailyBonus.isPending) {
      return;
    }

    const attemptKey = `${userId}:${getBeijingDateString()}`;
    if (lastAttemptKeyRef.current === attemptKey) {
      return;
    }

    lastAttemptKeyRef.current = attemptKey;
    claimDailyBonus.mutate();
  }, [claimDailyBonus, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) {
      lastAttemptKeyRef.current = null;
      return;
    }

    maybeClaimDailyBonus();
  }, [maybeClaimDailyBonus, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) {
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
  }, [maybeClaimDailyBonus, session?.user?.id]);

  return null;
}
