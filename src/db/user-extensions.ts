import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "./schema";
import { creditTransactions } from "./schema";

export const INITIAL_CREDITS = 10;

export async function initializeUserCredits(
  userId: string,
  db: DrizzleD1Database<typeof schema>,
): Promise<boolean> {
  try {
    // D1 不支持事务，直接执行操作
    // 检查是否已存在初始化记录
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
      return true; // 已初始化，返回成功
    }

    // 插入初始积分记录
    await db.insert(creditTransactions).values({
      userId,
      amount: INITIAL_CREDITS,
      type: "initial",
      description: "Initial registration bonus",
    });

    console.log(`Successfully initialized credits for user ${userId}`);
    return true;
  } catch (error) {
    console.error(`Failed to initialize credits for user ${userId}:`, error);
    return false;
  }
}
