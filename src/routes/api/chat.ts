import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "#/db/schema";
import { chatMessages, chatSessions } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  buildChatSystemPrompt,
  buildChatTools,
  CHAT_LIMITS,
  checkChatRateLimit,
  getChatModel,
  loadAccessiblePaper,
} from "#/lib/chat";
import {
  getReviewGuestServerSession,
  isReviewGuestModeEnabled,
} from "#/lib/review-guest";

/**
 * 论文 chatbot 的流式端点。独立于 tRPC：superjson transformer 不支持流式响应。
 * 前端 useChat + DefaultChatTransport 每次只发最后一条 UIMessage，
 * 历史从 D1 取（真源在 D1，不信任客户端历史）。
 *
 * 会话创建不在这里（tRPC createSession 负责），本路由要求 sessionId 已存在。
 */

const bodySchema = z.object({
  sessionId: z.string().min(1),
  paperShortId: z.string().min(1).max(10),
  locale: z.string().max(10).default("en"),
  message: z.object({
    id: z.string().min(1),
    role: z.literal("user"),
    parts: z.array(z.record(z.string(), z.unknown())).min(1),
  }),
});

/**
 * `error` 是稳定 CODE（不是给人看的文案），前端按 code 映射 i18n 文案。Codes:
 * unauthorized | bad_request | message_too_long | session_not_found | forbidden
 * | session_full | rate_limited_minute | rate_limited_day
 */
function jsonError(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** UIMessage parts 里的纯文本总长（限流用） */
function textLength(parts: { type?: unknown; text?: unknown }[]): number {
  return parts.reduce(
    (n, p) =>
      n + (p.type === "text" && typeof p.text === "string" ? p.text.length : 0),
    0,
  );
}

async function handler({ request }: { request: Request }) {
  const appEnv = env as typeof env & {
    DB: D1Database;
    PAPERS_BUCKET: R2Bucket;
    OPENAI_API_KEY: string;
    OPENAI_BASE_URL?: string;
    OPENAI_MODEL?: string;
    CF_API_TOKEN?: string;
  };
  const db = drizzle(appEnv.DB, { schema });

  const session =
    (await auth.api.getSession({ headers: request.headers })) ??
    (isReviewGuestModeEnabled() ? await getReviewGuestServerSession(db) : null);
  if (!session) return jsonError("unauthorized", 401);
  const userId = session.user.id;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("bad_request", 400);
  const { sessionId, paperShortId, locale, message } = parsed.data;

  if (textLength(message.parts) > CHAT_LIMITS.maxInputChars) {
    return jsonError("message_too_long", 413);
  }

  const [chatSession] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
    .limit(1);
  if (!chatSession) return jsonError("session_not_found", 404);

  const paper = await loadAccessiblePaper(db, paperShortId, userId);
  if (!paper || paper.id !== chatSession.paperId) {
    return jsonError("forbidden", 403);
  }

  const [msgCountRow] = await db
    .select({ n: count() })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId));
  if ((msgCountRow?.n ?? 0) >= CHAT_LIMITS.maxMessagesPerSession) {
    return jsonError("session_full", 409);
  }

  const rate = await checkChatRateLimit(db, userId);
  if (!rate.ok) return jsonError(rate.code, 429);

  // 历史窗口（真源 D1）+ 本条新消息
  const historyRows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(chatMessages.createdAt)
    .limit(CHAT_LIMITS.maxMessagesPerSession);
  const history = historyRows
    .slice(-CHAT_LIMITS.historyWindow)
    .map((r) => ({ id: r.id, role: r.role, parts: r.parts }) as UIMessage);
  const uiMessages: UIMessage[] = [...history, message as unknown as UIMessage];

  // 先落用户消息（也让限流计数即时生效）
  await db.insert(chatMessages).values({
    id: message.id,
    sessionId,
    userId,
    role: "user",
    parts: message.parts,
  });
  const sessionPatch: Partial<typeof chatSessions.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (!chatSession.title) {
    const firstText = message.parts.find((p) => p.type === "text")?.text;
    if (typeof firstText === "string" && firstText) {
      sessionPatch.title = firstText.slice(0, 80);
    }
  }
  await db
    .update(chatSessions)
    .set(sessionPatch)
    .where(eq(chatSessions.id, sessionId));

  const instructions = await buildChatSystemPrompt(db, paper, locale);
  const tools = buildChatTools(appEnv.PAPERS_BUCKET, paper.id);
  const result = streamText({
    model: getChatModel(appEnv),
    instructions,
    // v7: convertToModelMessages 是 async 的，必须 await
    messages: await convertToModelMessages(uiMessages),
    tools,
    stopWhen: isStepCount(8),
    // OpenRouter 服务端网页搜索（Exa 支撑），与本地 tools 不冲突；
    // 引用在 providerMetadata.openrouter.annotations
    providerOptions: {
      openrouter: {
        plugins: [{ id: "web", max_results: 5 }],
      },
    },
    onError: ({ error }) => {
      console.error("[chat] stream error:", error);
    },
  });

  const uiStream = toUIMessageStream({
    stream: result.stream,
    tools,
    originalMessages: uiMessages,
    // 必须显式给：没有它时响应消息的 id 会是空串（originalMessages 最后一条是
    // user，SDK 只在续写 assistant 消息时复用其 id），落库会撞主键。
    generateMessageId: () => crypto.randomUUID(),
    // v7: onFinish 已 deprecated，改名 onEnd（形状不变，仍有 responseMessage）
    onEnd: async ({ responseMessage }) => {
      try {
        await db.insert(chatMessages).values({
          id: responseMessage.id,
          sessionId,
          userId,
          role: "assistant",
          parts: responseMessage.parts,
        });
        await db
          .update(chatSessions)
          .set({ updatedAt: new Date() })
          .where(eq(chatSessions.id, sessionId));
      } catch (error) {
        // 落库失败不能炸流（此刻响应体可能已发完/已被取消）
        console.error("[chat] persist assistant message failed:", error);
      }
    },
  });

  // 客户端断开也要落库助手消息：consumeStream 从 result 再 tee 一路自行读完，
  // 响应体那一路被取消时底层生成不会卡死，onEnd（cancel 分支）照样执行。
  void result.consumeStream();

  return createUIMessageStreamResponse({ stream: uiStream });
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: handler,
    },
  },
});
