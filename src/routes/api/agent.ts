import { createFileRoute } from "@tanstack/react-router";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  conversationMembers,
  conversationMessages,
  conversations,
  userProfiles,
} from "#/db/schema";
import {
  AGENT_LIMITS,
  buildAgentSystemPrompt,
  buildAgentTools,
  checkAgentRateLimit,
} from "#/lib/agent";
import {
  type AuthorizeResult,
  chatStreamBody,
  createChatStreamHandler,
} from "#/lib/chat-stream";
import {
  CARD_TOOL_TYPES,
  digestRecommendPapersForReplay,
} from "#/lib/discovery-tools";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";

/**
 * Assistant agent 的流式端点。会话创建走 tRPC assistant.createConversation，
 * 本路由要求 conversationId 已存在且当前用户是成员。
 * 错误码复用 chat-errors 码表（conversation 缺失 → session_not_found）。
 * 管线时序与不变量见 #/lib/chat-stream。
 */

const bodySchema = chatStreamBody.extend({
  conversationId: z.string().min(1),
});
type Body = z.infer<typeof bodySchema>;

interface AgentCtx {
  conversation: typeof conversations.$inferSelect;
}

const handler = createChatStreamHandler<Body, AgentCtx>({
  logTag: "agent",
  bodySchema,
  limits: {
    maxInputChars: AGENT_LIMITS.maxInputChars,
    maxMessages: AGENT_LIMITS.maxMessagesPerConversation,
    webSearchMaxResults: AGENT_LIMITS.webSearchMaxResults,
  },
  maxToolSteps: 10,
  keepToolOutputTypes: CARD_TOOL_TYPES,
  // 卡片 output 落库 ⇒ 刷新后用户还看得见 ⇒ 模型也必须看得见（见 replayToolDigest）
  replayToolDigest: digestRecommendPapersForReplay,

  authorize: async ({
    db,
    userId,
    body,
  }): Promise<AuthorizeResult<AgentCtx>> => {
    // 归属校验：members 里有本人（将来 channel 复用同一条查询）
    const [convRow] = await db
      .select({ conversation: conversations })
      .from(conversations)
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, conversations.id),
          eq(conversationMembers.userId, userId),
        ),
      )
      .where(eq(conversations.id, body.conversationId))
      .limit(1);
    if (!convRow) return { ok: false, code: "session_not_found", status: 404 };
    return { ok: true, ctx: { conversation: convRow.conversation } };
  },

  countMessages: async ({ db, body }) => {
    const [row] = await db
      .select({ n: count() })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, body.conversationId));
    return row?.n ?? 0;
  },

  checkRateLimit: checkAgentRateLimit,

  loadHistoryRows: async ({ db, body }) => {
    const rows = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, body.conversationId))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(AGENT_LIMITS.historyWindow);
    rows.reverse();
    // channel 预留：senderType 就是 UIMessage role（assistant 消息 senderId=NULL）
    return rows.map((row) => ({
      id: row.id,
      role: row.senderType,
      parts: row.parts,
    }));
  },

  buildInstructions: async ({ db, userId, body }) => {
    const [profileRow] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    return buildAgentSystemPrompt(profileRow?.content ?? null, body.webSearch);
  },

  buildLocalTools: ({ db, env, session, userId, body }) =>
    buildAgentTools({
      db,
      bucket: env.PAPERS_BUCKET,
      userId,
      locale: body.locale,
      // 与 tRPC updateProfile 同一口径：mutations 开关打开时 guest 也可写档案
      isGuest: isReviewGuestReadOnlySession(session),
    }),

  persistUserMessage: async ({ db, userId, body }, { conversation }) => {
    // 幂等 upsert（客户端提供 id，regenerate 会复用）；setWhere 语义同 /api/chat
    await db
      .insert(conversationMessages)
      .values({
        id: body.message.id,
        conversationId: body.conversationId,
        senderType: "user",
        senderId: userId,
        parts: body.message.parts,
      })
      .onConflictDoUpdate({
        target: conversationMessages.id,
        set: { parts: body.message.parts },
        setWhere: and(
          eq(conversationMessages.conversationId, body.conversationId),
          eq(conversationMessages.senderId, userId),
        ),
      });
    const patch: Partial<typeof conversations.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (!conversation.title) {
      const firstText = body.message.parts[0]?.text;
      if (firstText) patch.title = firstText.slice(0, 80);
    }
    await db
      .update(conversations)
      .set(patch)
      .where(eq(conversations.id, body.conversationId));
  },

  persistAssistantMessage: async ({ db, body }, _ctx, message) => {
    await db.insert(conversationMessages).values({
      id: message.id,
      conversationId: body.conversationId,
      senderType: "assistant",
      senderId: null,
      parts: message.parts,
    });
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, body.conversationId));
  },
});

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: {
      POST: handler,
    },
  },
});
