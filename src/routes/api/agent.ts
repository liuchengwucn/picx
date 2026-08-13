import { createFileRoute } from "@tanstack/react-router";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  assistantSkills,
  conversationMembers,
  conversationMessages,
  conversations,
  userProfiles,
} from "#/db/schema";
import {
  AGENT_LIMITS,
  buildAgentSystemPrompt,
  checkAgentRateLimit,
} from "#/lib/agent";
import {
  type AuthorizeResult,
  type ChatStreamArgs,
  chatStreamBody,
  createChatResumeHandler,
  createChatStreamHandler,
} from "#/lib/chat-stream";
import { CARD_REPLAY_SPEC } from "#/lib/discovery-tools";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";
import {
  buildSkillsCatalogSection,
  parseSkillDirective,
  SKILL_LIMITS,
} from "#/lib/skills";

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

/** 归属校验：members 里有本人（POST authorize 与 GET authorizeResume 共用，
 * 将来 channel 复用同一条查询） */
async function loadMemberConversation(
  db: ChatStreamArgs<Body>["db"],
  userId: string,
  conversationId: string,
): Promise<typeof conversations.$inferSelect | undefined> {
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
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return convRow?.conversation;
}

const handler = createChatStreamHandler<Body, AgentCtx>({
  logTag: "agent",
  bodySchema,
  limits: {
    maxInputChars: AGENT_LIMITS.maxInputChars,
    maxMessages: AGENT_LIMITS.maxMessagesPerConversation,
  },
  // 落库口径（keepToolOutputTypes）已随生成阶段移交 GENERATION_SPECS；请求期只剩
  // 历史重放要用的摘要口径，两者仍同源于 CARD_REPLAY_SPEC（口径见 discovery-tools）
  replayToolDigest: CARD_REPLAY_SPEC.replayToolDigest,

  conversationKey: (body) => body.conversationId,

  buildJob: ({ userId, session, body }, _ctx, prepared) => ({
    kind: "agent",
    conversationId: body.conversationId,
    userId,
    locale: body.locale,
    webSearch: body.webSearch,
    reasoningEffort: body.reasoningEffort,
    // 与 tRPC updateProfile 同一口径：mutations 开关打开时 guest 也可写档案
    isGuest: isReviewGuestReadOnlySession(session),
    instructions: prepared.instructions,
    modelMessages: prepared.modelMessages,
  }),

  authorize: async ({
    db,
    userId,
    body,
  }): Promise<AuthorizeResult<AgentCtx>> => {
    const conversation = await loadMemberConversation(
      db,
      userId,
      body.conversationId,
    );
    if (!conversation) {
      return { ok: false, code: "session_not_found", status: 404 };
    }
    return { ok: true, ctx: { conversation } };
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
    // catalog 查询失败不阻断对话：跳过注入，agent 只是这一轮不知道 skills 存在
    const loadCatalog = async () => {
      try {
        const rows = await db
          .select({
            name: assistantSkills.name,
            description: assistantSkills.description,
          })
          .from(assistantSkills)
          .where(
            and(
              eq(assistantSkills.userId, userId),
              eq(assistantSkills.enabled, true),
            ),
          )
          .orderBy(desc(assistantSkills.updatedAt))
          .limit(SKILL_LIMITS.catalogMaxEntries + 1);
        return buildSkillsCatalogSection(
          rows.slice(0, SKILL_LIMITS.catalogMaxEntries),
          rows.length > SKILL_LIMITS.catalogMaxEntries,
        );
      } catch {
        return "";
      }
    };
    const [profileRows, skillsCatalog] = await Promise.all([
      db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1),
      loadCatalog(),
    ]);
    return buildAgentSystemPrompt(
      profileRows[0]?.content ?? null,
      body.webSearch,
      skillsCatalog,
    );
  },

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
      if (firstText) {
        // slash 指令消息落库是 <agent_skill /> 原始标记；标题改用人类可读的 /name args
        const directive = parseSkillDirective(firstText);
        const titleText = directive
          ? `/${directive.name} ${directive.args}`.trim()
          : firstText;
        patch.title = titleText.slice(0, 80);
      }
    }
    await db
      .update(conversations)
      .set(patch)
      .where(eq(conversations.id, body.conversationId));
  },
});

const resumeHandler = createChatResumeHandler({
  logTag: "agent",
  querySchema: z.object({ conversationId: z.string().min(1) }),
  authorizeResume: async (db, userId, q) =>
    (await loadMemberConversation(db, userId, q.conversationId)) != null,
  conversationKey: (q) => q.conversationId,
});

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: {
      POST: handler,
      GET: resumeHandler,
    },
  },
});
