import { drizzle } from "drizzle-orm/d1";
import { eq, lt } from "drizzle-orm";
import * as schema from "#/db/schema";
import type { Env } from "#/types/env";

const MAX_CREDIT = 20;
const DAILY_BONUS = 1;

/**
 * Daily credit bonus cron handler
 * Runs every day at 00:00 Beijing Time (16:00 UTC)
 * Adds 1 credit to users with less than 20 credits
 */
export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const startTime = Date.now();
    console.log(
      "[Daily Credit Bonus] Starting at",
      new Date(controller.scheduledTime).toISOString(),
    );

    const db = drizzle(env.DB, { schema });

    try {
      // Query all users with credits < 20
      const usersNeedingBonus = await db
        .select({
          id: schema.user.id,
          credits: schema.user.credits,
        })
        .from(schema.user)
        .where(lt(schema.user.credits, MAX_CREDIT));

      if (usersNeedingBonus.length === 0) {
        console.log("[Daily Credit Bonus] No users need bonus");
        return;
      }

      console.log(
        `[Daily Credit Bonus] Processing ${usersNeedingBonus.length} users`,
      );

      let successCount = 0;
      let failCount = 0;

      // Process each user
      for (const user of usersNeedingBonus) {
        try {
          // Add fixed daily bonus (1 credit)
          const newCredit = Math.min(user.credits + DAILY_BONUS, MAX_CREDIT);
          const actualBonus = newCredit - user.credits;

          // Update user credits
          await db
            .update(schema.user)
            .set({ credits: newCredit })
            .where(eq(schema.user.id, user.id));

          // Record transaction
          await db.insert(schema.creditTransactions).values({
            userId: user.id,
            amount: actualBonus,
            type: "daily_bonus",
            description: `Daily bonus: ${user.credits} → ${newCredit}`,
          });

          console.log(
            `[Daily Credit Bonus] User ${user.id}: ${user.credits} → ${newCredit} (+${actualBonus})`,
          );
          successCount++;
        } catch (error) {
          console.error(
            `[Daily Credit Bonus] Failed to process user ${user.id}:`,
            error,
          );
          failCount++;
        }
      }

      const duration = Date.now() - startTime;
      console.log(
        `[Daily Credit Bonus] Completed in ${duration}ms: ${successCount} success, ${failCount} failed`,
      );
    } catch (error) {
      console.error("[Daily Credit Bonus] Fatal error:", error);
      throw error;
    }
  },
};
