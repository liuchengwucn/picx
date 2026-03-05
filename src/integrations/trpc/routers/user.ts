import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { creditTransactions } from "#/db/schema";
import { publicProcedure, router } from "../init";

export const userRouter = router({
	getProfile: publicProcedure.query(async ({ ctx }) => {
		// Get user from Better Auth session
		const session = await ctx.auth.api.getSession({ headers: ctx.headers });
		if (!session) throw new Error("Unauthorized");

		return {
			id: session.user.id,
			email: session.user.email,
			name: session.user.name,
			credits: session.user.credits,
		};
	}),

	getCreditHistory: publicProcedure
		.input(
			z.object({
				page: z.number().default(1),
				limit: z.number().default(20),
			}),
		)
		.query(async ({ ctx, input }) => {
			const session = await ctx.auth.api.getSession({ headers: ctx.headers });
			if (!session) throw new Error("Unauthorized");

			const offset = (input.page - 1) * input.limit;

			const transactions = await db
				.select()
				.from(creditTransactions)
				.where(eq(creditTransactions.userId, session.user.id))
				.orderBy(desc(creditTransactions.createdAt))
				.limit(input.limit)
				.offset(offset);

			const [totalResult] = await db
				.select({ count: sql<number>`count(*)` })
				.from(creditTransactions)
				.where(eq(creditTransactions.userId, session.user.id));

			return {
				transactions,
				total: totalResult.count,
			};
		}),
});
