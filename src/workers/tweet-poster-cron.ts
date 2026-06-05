import { and, desc, eq, gte, isNotNull, isNull, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  paperResults,
  papers,
  tweetQueue,
  whiteboardImages,
} from "#/db/schema";
import { paperImageUrl } from "#/lib/embed-code";
import {
  sendMessage,
  sendPhoto,
  type TelegramCredentials,
} from "#/lib/telegram-client";
import { pickTldr } from "#/lib/tldr";
import { renderWhiteboardImage } from "#/lib/whiteboard-render";
import { capCandidates, RECENT_WINDOW_HOURS } from "#/lib/x-candidate";
import {
  buildReplyText,
  buildTweetCaption,
  summaryToTweetText,
} from "#/lib/x-caption";
import { postTweet, uploadMedia, type XCredentials } from "#/lib/x-client";
import { recentSinceMs } from "#/lib/x-schedule";
import type { Env } from "#/types/env";

const GUEST_USER_ID = "review-guest-user";

function readXCreds(env: Env): XCredentials | null {
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

function readTelegramCreds(env: Env): TelegramCredentials | null {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return null;
  return { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID };
}

/**
 * 给运营者发一条 Telegram 通知（成功回执 / 失败告警共用）：
 * 有 shortId 就发带白板图的消息，否则发纯文本。本身失败只记日志，绝不影响发推主流程。
 */
async function notify(
  tg: TelegramCredentials | null,
  shortId: string | null,
  text: string,
): Promise<void> {
  if (!tg) {
    console.error("[TweetPoster] no telegram creds, cannot notify");
    return;
  }
  try {
    if (shortId) {
      await sendPhoto(tg, paperImageUrl(shortId), text);
    } else {
      await sendMessage(tg, text);
    }
  } catch (err) {
    console.error("[TweetPoster] telegram notify failed", String(err));
  }
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const now = controller.scheduledTime;
    const db = drizzle(env.DB);
    console.log("[TweetPoster] start", new Date(now).toISOString());

    const tg = readTelegramCreds(env);
    const xCreds = readXCreds(env);
    if (!xCreds) {
      // 凭证缺失也告警，否则会静默哑火。
      console.error("[TweetPoster] X credentials missing, skip");
      await notify(tg, null, "⚠️ 今日 X 发推失败：X 凭证缺失");
      return;
    }

    // 已投递过的 paper_id（sent + error 都算，避免重复）。规模小，取全表。
    const seen = await db
      .select({ paperId: tweetQueue.paperId, sentAt: tweetQueue.sentAt })
      .from(tweetQueue);
    const seenIds = seen.map((r) => r.paperId);

    const sinceMs = recentSinceMs(now, RECENT_WINDOW_HOURS);

    // 今日（同一 24h 窗口内）已成功发出的篇数，用于通知文案标注「今日第 N 篇」。
    const sentToday = seen.filter(
      (r) => r.sentAt != null && r.sentAt.getTime() >= sinceMs,
    ).length;

    // 候选：guest + 近 24h + 已完成 + 有默认白板 + upvotes 非 NULL + 未投递过。
    const baseWhere = and(
      eq(papers.userId, GUEST_USER_ID),
      eq(papers.isPublic, true),
      eq(papers.isListedInGallery, true),
      eq(papers.status, "completed"),
      isNull(papers.deletedAt),
      gte(papers.publishedAt, new Date(sinceMs)), // 防洪护栏一
      isNotNull(papers.upvotes), // 防洪护栏二（历史 NULL 天然排除）
    );

    const rows = await db
      .select({
        id: papers.id,
        shortId: papers.shortId,
        upvotes: papers.upvotes,
        tldr: paperResults.tldr,
        summaries: paperResults.summaries,
        categories: paperResults.categories,
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

    const normalized = rows.map((r) => ({ ...r, upvotes: r.upvotes ?? 0 }));
    const [selected] = capCandidates(normalized); // 防洪护栏三：cap=1，取 top-1

    if (!selected) {
      console.log("[TweetPoster] no candidate");
      return;
    }

    // tldr 生成曾失败(字段为空)时回退到 summary(压成纯文本),
    // 避免发出空正文推文——与 gallery 的读时兜底保持一致。
    const tldrText = pickTldr(selected.tldr, "en");
    const summaryText = pickTldr(selected.summaries, "en");
    const body =
      tldrText ?? (summaryText ? summaryToTweetText(summaryText) : "");
    const categories = selected.categories ?? [];
    const caption = buildTweetCaption({ tldr: body, categories });

    try {
      // 内联渲染带水印白板图（D1 + R2 + Photon），上传到 X 作为媒体附件。
      // 不再 fetch 公网 image 端点：worker 回环打自己的 zone 易触发 522 超时。
      const imageData = await renderWhiteboardImage(selected.shortId, env);
      if (!imageData) {
        throw new Error(`Render image failed: ${selected.shortId}`);
      }
      const mediaId = await uploadMedia(imageData, xCreds);

      const { tweetId } = await postTweet(caption, xCreds, {
        mediaIds: [mediaId],
      });
      await db.insert(tweetQueue).values({
        paperId: selected.id,
        caption,
        status: "sent",
        tweetId,
        sentAt: new Date(now),
      });
      console.log("[TweetPoster] posted", selected.id, tweetId);

      // 主推（图片）已发出 → 在其下追发一条带链接的回复推。
      // X 对外链降权，故把 picx.dev 链接拆到回复里，不拉低主推分发权重。
      // 回复推失败不回滚主推（无法撤回）：仅记日志 + Telegram 告警。
      try {
        const { tweetId: replyId } = await postTweet(
          buildReplyText(selected.shortId),
          xCreds,
          { replyToTweetId: tweetId },
        );
        console.log("[TweetPoster] reply posted", selected.id, replyId);
      } catch (replyErr) {
        console.error(
          "[TweetPoster] reply failed",
          selected.id,
          String(replyErr),
        );
        await notify(
          tg,
          null,
          `⚠️ 主推已发，但链接回复失败：${String(replyErr)}\nhttps://x.com/i/web/status/${tweetId}`,
        );
      }
      // 成功回执：纯文本 + 推文链接（不带白板图与文案）。
      // 标注「今日第 N 篇」，区分 22:00 / 22:30 / 23:00 三次发送。
      await notify(
        tg,
        null,
        `✅ 今日已发 X（第 ${sentToday + 1} 篇）\nhttps://x.com/i/web/status/${tweetId}`,
      );
    } catch (err) {
      // 发送失败：记 error 行（占用 paper_id，不自动重试），并 Telegram 告警。
      await db
        .insert(tweetQueue)
        .values({
          paperId: selected.id,
          caption,
          status: "error",
          errorMsg: String(err),
        })
        .onConflictDoNothing();
      console.error("[TweetPoster] post failed", selected.id, String(err));
      await notify(
        tg,
        selected.shortId,
        `⚠️ 今日 X 发推失败：${String(err)}\n\n${caption}`,
      );
    }
  },
};
