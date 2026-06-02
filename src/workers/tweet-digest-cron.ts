import { and, desc, eq, gte, isNotNull, isNull, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  paperResults,
  papers,
  tweetQueue,
  whiteboardImages,
} from "#/db/schema";
import { paperImageUrl } from "#/lib/embed-code";
import { sendPhoto, type TelegramCredentials } from "#/lib/telegram-client";
import { pickTldr } from "#/lib/tldr";
import { capCandidates, RECENT_WINDOW_HOURS } from "#/lib/x-candidate";
import { buildTweetCaption } from "#/lib/x-caption";
import { recentSinceMs } from "#/lib/x-schedule";
import type { Env } from "#/types/env";

const GUEST_USER_ID = "review-guest-user";

function readCreds(env: Env): TelegramCredentials | null {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return null;
  return {
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
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
    console.log("[TweetDigest] start", new Date(now).toISOString());

    const creds = readCreds(env);
    if (!creds) {
      console.error("[TweetDigest] Telegram credentials missing, skip");
      return;
    }

    // 已投递过的 paper_id（sent + error 都算，避免重复推送）。规模小，取全表。
    const seen = await db
      .select({ paperId: tweetQueue.paperId })
      .from(tweetQueue);
    const seenIds = seen.map((r) => r.paperId);

    const sinceMs = recentSinceMs(now, RECENT_WINDOW_HOURS);

    // 候选：guest + 近一天 + 已完成 + 有默认白板 + upvotes 达标 + 未投递过。
    // join 模式与 paper.listPublic 一致。
    const baseWhere = and(
      eq(papers.userId, GUEST_USER_ID),
      eq(papers.isPublic, true),
      eq(papers.isListedInGallery, true),
      eq(papers.status, "completed"),
      isNull(papers.deletedAt),
      gte(papers.publishedAt, new Date(sinceMs)), // 防洪护栏一
      isNotNull(papers.upvotes), // 排除历史 NULL upvotes 论文（再加一层防洪）
    );

    const rows = await db
      .select({
        id: papers.id,
        shortId: papers.shortId,
        upvotes: papers.upvotes,
        tldr: paperResults.tldr,
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
        seenIds.length > 0
          ? and(baseWhere, notInArray(papers.id, seenIds))
          : baseWhere,
      )
      .orderBy(desc(papers.upvotes));

    // upvotes 可能为 null（理论上被 gte 过滤掉），收敛为 number 以满足 capCandidates。
    const normalized = rows.map((r) => ({ ...r, upvotes: r.upvotes ?? 0 }));
    const selected = capCandidates(normalized); // 防洪护栏二

    if (selected.length === 0) {
      console.log("[TweetDigest] no candidates");
      return;
    }

    let sent = 0;
    for (const p of selected) {
      const tldr = pickTldr(p.tldr, "en") ?? "";
      const caption = buildTweetCaption({ tldr, shortId: p.shortId });
      try {
        await sendPhoto(creds, paperImageUrl(p.shortId), caption);
        await db.insert(tweetQueue).values({
          paperId: p.id,
          caption,
          status: "sent",
          sentAt: new Date(now),
        });
        sent++;
      } catch (err) {
        // 发送失败：记一条 error 行（占用 paper_id，不会自动重试；可手动清理重发）。
        await db
          .insert(tweetQueue)
          .values({
            paperId: p.id,
            caption,
            status: "error",
            errorMsg: String(err),
          })
          .onConflictDoNothing();
        console.error("[TweetDigest] send failed", p.id, String(err));
      }
    }

    console.log(`[TweetDigest] sent ${sent}/${selected.length} to Telegram`);
  },
};
