import { TRPCError } from "@trpc/server";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { creditTransactions, user } from "#/db/schema";
import { claimDailyBonusIfEligible } from "#/db/user-extensions";
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
   * Get user's credit transaction history with pagination
   * @param page - Page number (min: 1)
   * @param limit - Items per page (min: 1, max: 100)
   * @returns Paginated credit transactions and total count
   * @throws UNAUTHORIZED if user is not logged in
   */
  getCreditHistory: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.limit;

      const transactions = await ctx.db
        .select()
        .from(creditTransactions)
        .where(eq(creditTransactions.userId, ctx.session.user.id))
        .orderBy(desc(creditTransactions.createdAt))
        .limit(input.limit)
        .offset(offset);

      const [totalResult] = await ctx.db
        .select({ count: count() })
        .from(creditTransactions)
        .where(eq(creditTransactions.userId, ctx.session.user.id));

      return {
        transactions,
        total: totalResult.count,
      };
    }),

  claimDailyBonus: protectedProcedure.mutation(async ({ ctx }) => {
    return claimDailyBonusIfEligible(ctx.session.user.id, ctx.db);
  }),
});
