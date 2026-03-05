import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { creditTransactions } from "./schema";

export const INITIAL_CREDITS = 10;

export async function initializeUserCredits(userId: string): Promise<boolean> {
	try {
		// 幂等性检查：检查是否已存在初始化记录
		const existing = await db
			.select()
			.from(creditTransactions)
			.where(
				and(
					eq(creditTransactions.userId, userId),
					eq(creditTransactions.type, "initial"),
				),
			)
			.limit(1);

		if (existing.length > 0) {
			console.log(`User ${userId} credits already initialized, skipping`);
			return true;
		}

		// 插入初始积分记录
		await db.insert(creditTransactions).values({
			userId,
			amount: INITIAL_CREDITS,
			type: "initial",
			description: "注册赠送",
		});

		console.log(`Successfully initialized credits for user ${userId}`);
		return true;
	} catch (error) {
		console.error(`Failed to initialize credits for user ${userId}:`, error);
		return false;
	}
}
