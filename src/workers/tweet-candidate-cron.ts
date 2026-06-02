import { and, desc, eq, gte, isNull, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  paperResults,
  papers,
  tweetQueue,
  whiteboardImages,
} from "#/db/schema";
import { pickTldr } from "#/lib/tldr";
import {
  capCandidates,
  RECENT_WINDOW_HOURS,
  TWEET_MIN_UPVOTES,
} from "#/lib/x-candidate";
import { buildTweetCaption } from "#/lib/x-caption";
import { computeScheduleTimes, recentSinceMs } from "#/lib/x-schedule";
import type { Env } from "#/types/env";

const GUEST_USER_ID = "review-guest-user";
// 排期：第一条相对运行时刻的延迟（分钟），之后每条的间隔（分钟）。
const FIRST_DELAY_MIN = 10;
const POST_INTERVAL_MIN = 90;

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const now = controller.scheduledTime;
    const db = drizzle(env.DB);
    console.log("[TweetCandidate] start", new Date(now).toISOString());

    // 已入队的 paper_id（去重）。规模小，直接取全表 id 集合。
    const queued = await db
      .select({ paperId: tweetQueue.paperId })
      .from(tweetQueue);
    const queuedIds = queued.map((r) => r.paperId);

    const sinceMs = recentSinceMs(now, RECENT_WINDOW_HOURS);

    // 候选查询：guest + 今天 + 已完成 + 有默认白板 + upvotes 达标 + 未入队。
    // join 模式与 paper.listPublic 一致。
    const baseWhere = and(
      eq(papers.userId, GUEST_USER_ID),
      eq(papers.isPublic, true),
      eq(papers.isListedInGallery, true),
      eq(papers.status, "completed"),
      isNull(papers.deletedAt),
      gte(papers.publishedAt, new Date(sinceMs)), // 防洪护栏一
      gte(papers.upvotes, TWEET_MIN_UPVOTES),
    );

    const rows = await db
      .select({
        id: papers.id,
        shortId: papers.shortId,
        title: papers.title,
        upvotes: papers.upvotes,
        tldr: paperResults.tldr,
        summaries: paperResults.summaries,
      })
      .from(papers)
      .innerJoin(
        whiteboardImages,
        and(
          eq(papers.id, whiteboardImages.paperId),
          eq(whiteboardImages.isDefault, true),
        ),
      )
      .leftJoin(paperResults, eq(paperResults.paperId, papers.id))
      .where(
        queuedIds.length > 0
          ? and(baseWhere, notInArray(papers.id, queuedIds))
          : baseWhere,
      )
      .orderBy(desc(papers.upvotes));

    // upvotes 可能为 null（理论上被 gte 过滤掉），收敛为 number 以满足 capCandidates。
    const normalized = rows.map((r) => ({ ...r, upvotes: r.upvotes ?? 0 }));
    const selected = capCandidates(normalized); // 防洪护栏二

    if (selected.length === 0) {
      console.log("[TweetCandidate] no candidates");
      return;
    }

    const baseMs = now + FIRST_DELAY_MIN * 60_000;
    const times = computeScheduleTimes(
      selected.length,
      baseMs,
      POST_INTERVAL_MIN,
    );

    let enqueued = 0;
    for (let i = 0; i < selected.length; i++) {
      const p = selected[i];
      const tldr = pickTldr(p.tldr, "en") ?? "";
      const caption = buildTweetCaption({
        title: p.title,
        tldr,
        shortId: p.shortId,
      });
      try {
        await db.insert(tweetQueue).values({
          paperId: p.id,
          lang: "en",
          caption,
          scheduledFor: new Date(times[i]),
          status: "pending",
        });
        enqueued++;
      } catch (err) {
        // paper_id 唯一约束撞了（并发/重跑）→ 跳过，不算错误。
        console.log("[TweetCandidate] skip duplicate", p.id, String(err));
      }
    }

    console.log(`[TweetCandidate] enqueued ${enqueued}/${selected.length}`);
  },
};
