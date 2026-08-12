import { createFileRoute } from "@tanstack/react-router";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { chatMessages, chatSessions } from "#/db/schema";
import {
  buildChatSystemPrompt,
  buildChatTools,
  CHAT_LIMITS,
  checkChatRateLimit,
  loadAccessiblePaper,
} from "#/lib/chat";
import {
  type AuthorizeResult,
  chatStreamBody,
  createChatStreamHandler,
} from "#/lib/chat-stream";
import { CARD_REPLAY_SPEC } from "#/lib/discovery-tools";

/**
 * 论文 chatbot 的流式端点。独立于 tRPC：superjson transformer 不支持流式响应。
 * 前端 useChat + DefaultChatTransport 每次只发最后一条 UIMessage。
 * 会话创建不在这里（tRPC createSession 负责），本路由要求 sessionId 已存在。
 * 管线时序与不变量见 #/lib/chat-stream。
 */

const bodySchema = chatStreamBody.extend({
  sessionId: z.string().min(1),
  paperShortId: z.string().min(1).max(10),
});
type Body = z.infer<typeof bodySchema>;

interface ChatCtx {
  chatSession: typeof chatSessions.$inferSelect;
  paper: NonNullable<Awaited<ReturnType<typeof loadAccessiblePaper>>>;
}

const handler = createChatStreamHandler<Body, ChatCtx>({
  logTag: "chat",
  bodySchema,
  limits: {
    maxInputChars: CHAT_LIMITS.maxInputChars,
    maxMessages: CHAT_LIMITS.maxMessagesPerSession,
    webSearchMaxResults: CHAT_LIMITS.webSearchMaxResults,
  },
  // 比 /api/agent 的 10 再宽一档，是拍的预算而非算出来的上界：论文页一轮里 readPaper
  // 要按 24k 一段翻页（十几万字的论文就是七八段），发现类工具又鼓励多角度搜索 + 边讲边
  // recommendPapers，每次交错都占一步。
  maxToolSteps: 12,
  // 卡片的落库口径与回放摘要成对给出，只接一半就是模型看不见用户屏幕上的卡片
  ...CARD_REPLAY_SPEC,

  authorize: async ({
    db,
    userId,
    body,
  }): Promise<AuthorizeResult<ChatCtx>> => {
    const [chatSession] = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.id, body.sessionId),
          eq(chatSessions.userId, userId),
        ),
      )
      .limit(1);
    if (!chatSession) {
      return { ok: false, code: "session_not_found", status: 404 };
    }
    const paper = await loadAccessiblePaper(db, body.paperShortId, userId);
    if (!paper || paper.id !== chatSession.paperId) {
      return { ok: false, code: "forbidden", status: 403 };
    }
    return { ok: true, ctx: { chatSession, paper } };
  },

  countMessages: async ({ db, body }) => {
    const [row] = await db
      .select({ n: count() })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, body.sessionId));
    return row?.n ?? 0;
  },

  checkRateLimit: checkChatRateLimit,

  loadHistoryRows: async ({ db, body }) => {
    // 直接按 created_at 倒序取窗口大小，别拉满 200 行再切尾部。
    // created_at 是毫秒精度：同一毫秒内并发插入的消息相对顺序不确定，
    // 实际上 user/assistant 是严格交替写入的，暂不引入自增 seq 列。
    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, body.sessionId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(CHAT_LIMITS.historyWindow);
    rows.reverse();
    return rows;
  },

  buildInstructions: ({ db, body }, { paper }) =>
    buildChatSystemPrompt(db, paper, body.locale, body.webSearch),

  buildLocalTools: ({ db, env, userId }, { paper }) =>
    buildChatTools({
      db,
      bucket: env.PAPERS_BUCKET,
      userId,
      paperId: paper.id,
    }),

  persistUserMessage: async ({ db, userId, body }, { chatSession }) => {
    // id 由客户端提供，regenerate/edit 会复用同一个 id，必须幂等，否则撞主键 500。
    // TODO: 真正的 regenerate 语义（重发时清掉该消息之后的助手消息）本期不做。
    await db
      .insert(chatMessages)
      .values({
        id: body.message.id,
        sessionId: body.sessionId,
        userId,
        role: "user",
        parts: body.message.parts,
      })
      .onConflictDoUpdate({
        target: chatMessages.id,
        set: { parts: body.message.parts },
        // 只在冲突行确实属于本会话+本用户时才改写，否则静默不动（SQLite upsert 的
        // DO UPDATE ... WHERE 里未加 excluded. 前缀的列指的是库里的原行）。
        // 客户端自选 message.id，跨会话重用同一个 id 时不能覆盖别人/别的会话的消息。
        setWhere: and(
          eq(chatMessages.sessionId, body.sessionId),
          eq(chatMessages.userId, userId),
        ),
      });
    const patch: Partial<typeof chatSessions.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (!chatSession.title) {
      const firstText = body.message.parts[0]?.text;
      if (firstText) patch.title = firstText.slice(0, 80);
    }
    await db
      .update(chatSessions)
      .set(patch)
      .where(eq(chatSessions.id, body.sessionId));
  },

  persistAssistantMessage: async ({ db, userId, body }, _ctx, message) => {
    await db.insert(chatMessages).values({
      id: message.id,
      sessionId: body.sessionId,
      userId,
      role: "assistant",
      parts: message.parts,
    });
    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, body.sessionId));
  },
});

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: handler,
    },
  },
});
