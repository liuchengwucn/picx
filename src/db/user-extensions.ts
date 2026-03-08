import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { getBeijingDateString } from "#/lib/beijing-date";
import type * as schema from "./schema";
import { creditTransactions, user } from "./schema";

export const INITIAL_CREDITS = 10;
export const DAILY_BONUS_CREDITS = 3;
export const MAX_CREDITS = 20;

export type DailyBonusClaimResult = {
  granted: boolean;
  amount: number;
  newCredits: number;
  reason: "granted" | "already_claimed" | "at_cap";
};

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

export async function claimDailyBonusIfEligible(
  userId: string,
  db: DrizzleD1Database<typeof schema>,
): Promise<DailyBonusClaimResult> {
  const today = getBeijingDateString();

  const [currentUser] = await db
    .select({
      credits: user.credits,
      lastDailyBonusDate: user.lastDailyBonusDate,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!currentUser) {
    throw new Error(`User ${userId} not found`);
  }

  if (currentUser.credits >= MAX_CREDITS) {
    return {
      granted: false,
      amount: 0,
      newCredits: currentUser.credits,
      reason: "at_cap",
    };
  }

  if (currentUser.lastDailyBonusDate === today) {
    return {
      granted: false,
      amount: 0,
      newCredits: currentUser.credits,
      reason: "already_claimed",
    };
  }

  const [updatedUser] = await db
    .update(user)
    .set({
      credits: sql`min(${user.credits} + ${DAILY_BONUS_CREDITS}, ${MAX_CREDITS})`,
      lastDailyBonusDate: today,
    })
    .where(
      and(
        eq(user.id, userId),
        lt(user.credits, MAX_CREDITS),
        or(
          isNull(user.lastDailyBonusDate),
          sql`${user.lastDailyBonusDate} <> ${today}`,
        ),
      ),
    )
    .returning({
      credits: user.credits,
    });

  if (!updatedUser) {
    const [latestUser] = await db
      .select({
        credits: user.credits,
        lastDailyBonusDate: user.lastDailyBonusDate,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!latestUser) {
      throw new Error(`User ${userId} not found after daily bonus update`);
    }

    return latestUser.credits >= MAX_CREDITS
      ? {
          granted: false,
          amount: 0,
          newCredits: latestUser.credits,
          reason: "at_cap",
        }
      : {
          granted: false,
          amount: 0,
          newCredits: latestUser.credits,
          reason: "already_claimed",
        };
  }

  await db.insert(creditTransactions).values({
    userId,
    amount: DAILY_BONUS_CREDITS,
    type: "daily_bonus",
    description: `Daily active bonus: ${updatedUser.credits - DAILY_BONUS_CREDITS} → ${updatedUser.credits}`,
  });

  return {
    granted: true,
    amount: DAILY_BONUS_CREDITS,
    newCredits: updatedUser.credits,
    reason: "granted",
  };
}
