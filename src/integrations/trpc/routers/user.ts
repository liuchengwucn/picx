import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { creditTransactions } from "#/db/schema";
import { protectedProcedure, router } from "../init";

export const userRouter = router({
  /**
   * Get current user's profile information
   * @returns User profile with id, email, name, and credits
   * @throws UNAUTHORIZED if user is not logged in
   */
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    return {
      id: ctx.session.user.id,
      email: ctx.session.user.email,
      name: ctx.session.user.name,
      credits: ctx.session.user.credits,
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
});
