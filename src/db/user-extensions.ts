import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { creditTransactions } from "./schema";

export const INITIAL_CREDITS = 10;

export async function initializeUserCredits(userId: string): Promise<boolean> {
	try {
		// 使用事务确保原子性
		const result = await db.transaction(async (tx) => {
			// 在事务中检查是否已存在初始化记录
			const existing = await tx
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
				return false; // 表示跳过，不是错误
			}

			// 在事务中插入初始积分记录
			await tx.insert(creditTransactions).values({
				userId,
				amount: INITIAL_CREDITS,
				type: "initial",
				description: "注册赠送",
			});

			return true; // 表示成功插入
		});

		if (result) {
			console.log(`Successfully initialized credits for user ${userId}`);
		}
		return true; // 无论是跳过还是插入，都返回 true（没有错误）
	} catch (error) {
		console.error(`Failed to initialize credits for user ${userId}:`, error);
		return false;
	}
}
