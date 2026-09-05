import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { user } from "#/db/schema";
import {
  claimDailyBonusIfEligible,
  shouldStampLastSeen,
} from "#/db/user-extensions";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";
import { protectedProcedure, router } from "../init";

export const userRouter = router({
  /**
   * Get current user's profile information
   * @returns User profile with id, email, name, and credits
   * @throws UNAUTHORIZED if user is not logged in
   */
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const [currentUser] = await ctx.db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
        credits: user.credits,
      })
      .from(user)
      .where(eq(user.id, ctx.session.user.id))
      .limit(1);

    if (!currentUser) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    return {
      id: currentUser.id,
      email: currentUser.email,
      name: currentUser.name,
      credits: currentUser.credits,
    };
  }),

  /**
   * 会话心跳：客户端在挂载 / 聚焦时打一次。两件事各自幂等、互不依赖（D1 无事务）：
   * 1. 距上次 lastSeenAt 满一小时就盖戳——积分满 20 的用户以前因 lastDailyBonusDate
   *    不再更新而「记录不了活跃」，这一条把它解开；
   * 2. 领当日 +3（条件由 claimDailyBonusIfEligible 判）。
   * 只返回 granted：前端拿它决定要不要失效 getProfile，不再向用户播报金额。
   */
  heartbeat: protectedProcedure.mutation(async ({ ctx }) => {
    if (isReviewGuestReadOnlySession(ctx.session)) {
      return { granted: false };
    }

    const userId = ctx.session.user.id;
    const now = new Date();

    const [row] = await ctx.db
      .select({ lastSeenAt: user.lastSeenAt })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }

    if (shouldStampLastSeen(row.lastSeenAt, now)) {
      await ctx.db
        .update(user)
        .set({ lastSeenAt: now })
        .where(eq(user.id, userId));
    }

    const bonus = await claimDailyBonusIfEligible(userId, ctx.db);
    return { granted: bonus.granted };
  }),
});
