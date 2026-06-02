import { and, asc, eq, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { tweetQueue } from "#/db/schema";
import { postTweet, type XCredentials } from "#/lib/x-client";
import type { Env } from "#/types/env";

function readCreds(env: Env): XCredentials | null {
  if (
    !env.X_API_KEY ||
    !env.X_API_SECRET ||
    !env.X_ACCESS_TOKEN ||
    !env.X_ACCESS_SECRET
  ) {
    return null;
  }
  return {
    apiKey: env.X_API_KEY,
    apiSecret: env.X_API_SECRET,
    accessToken: env.X_ACCESS_TOKEN,
    accessSecret: env.X_ACCESS_SECRET,
  };
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const now = controller.scheduledTime;
    const db = drizzle(env.DB);

    const creds = readCreds(env);
    if (!creds) {
      console.error("[TweetPoster] X credentials missing, skip");
      return;
    }

    // 取最早一条到点的待发。
    const [next] = await db
      .select()
      .from(tweetQueue)
      .where(
        and(
          eq(tweetQueue.status, "pending"),
          lte(tweetQueue.scheduledFor, new Date(now)),
        ),
      )
      .orderBy(asc(tweetQueue.scheduledFor))
      .limit(1);

    if (!next) return;

    // 抢锁：仅当仍为 pending 时置 posting。D1 无事务，靠状态条件防并发重发。
    const lock = await db
      .update(tweetQueue)
      .set({ status: "posting" })
      .where(and(eq(tweetQueue.id, next.id), eq(tweetQueue.status, "pending")))
      .returning({ id: tweetQueue.id });

    if (lock.length === 0) {
      console.log("[TweetPoster] lost race, skip", next.id);
      return;
    }

    try {
      const { tweetId } = await postTweet(next.caption, creds);
      await db
        .update(tweetQueue)
        .set({ status: "posted", tweetId, postedAt: new Date(now) })
        .where(eq(tweetQueue.id, next.id));
      console.log("[TweetPoster] posted", next.id, tweetId);
    } catch (err) {
      await db
        .update(tweetQueue)
        .set({ status: "error", errorMsg: String(err) })
        .where(eq(tweetQueue.id, next.id));
      console.error("[TweetPoster] post failed", next.id, String(err));
    }
  },
};
