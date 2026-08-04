import { env, waitUntil } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { and, count, desc, eq } from "drizzle-orm";
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
    // 只收文本 part。放行任意形状的 part 有两个后果：无 type 的 part 会让
    // convertToModelMessages 直接抛（500），而用户消息此时已落库 → 整个会话
    // 每次重放都炸；file part 还能绕过字符数限流塞进任意体积。
    parts: z
      .array(z.object({ type: z.literal("text"), text: z.string().min(1) }))
      .min(1)
      .max(32),
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
function textLength(parts: { text: string }[]): number {
  return parts.reduce((n, p) => n + p.text.length, 0);
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

  // 历史窗口（真源 D1）+ 本条新消息。
  // 直接按 created_at 倒序取窗口大小，别拉满 200 行再切尾部。
  // created_at 是毫秒精度：同一毫秒内并发插入的消息相对顺序不确定，
  // 实际上 user/assistant 是严格交替写入的，暂不引入自增 seq 列。
  const historyRows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(CHAT_LIMITS.historyWindow);
  historyRows.reverse();
  const history: UIMessage[] = historyRows
    .map((r) => ({
      id: r.id,
      role: r.role,
      // 重放只带文本 part：readPaper 的工具输出单段可达 24k 字符，整窗重放会爆
      // 上下文。工具输出仍完整存在 D1（供前端回显），只是不喂回模型。
      parts: (r.parts as UIMessage["parts"]).filter((p) => p.type === "text"),
    }))
    .filter((m) => m.parts.length > 0);
  const uiMessages: UIMessage[] = [...history, message as UIMessage];

  // 先把可能抛异常的准备工作做完，再写库：顺序反过来的话，一条畸形历史/新消息
  // 会让用户消息已落库但请求 500，此后该会话每次重放都炸；同时也避免请求还没
  // 真正打到模型就先烧掉一次限流配额。
  const instructions = await buildChatSystemPrompt(db, paper, locale);
  // v7: convertToModelMessages 是 async 的，必须 await
  const modelMessages = await convertToModelMessages(uiMessages);

  // 落用户消息（也让限流计数即时生效）。
  // id 由客户端提供，regenerate/edit 会复用同一个 id，必须幂等，否则撞主键 500。
  // TODO: 真正的 regenerate 语义（重发时清掉该消息之后的助手消息）本期不做。
  await db
    .insert(chatMessages)
    .values({
      id: message.id,
      sessionId,
      userId,
      role: "user",
      parts: message.parts,
    })
    .onConflictDoUpdate({
      target: chatMessages.id,
      set: { parts: message.parts },
    });
  const sessionPatch: Partial<typeof chatSessions.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (!chatSession.title) {
    const firstText = message.parts[0]?.text;
    if (firstText) sessionPatch.title = firstText.slice(0, 80);
  }
  await db
    .update(chatSessions)
    .set(sessionPatch)
    .where(eq(chatSessions.id, sessionId));

  const tools = buildChatTools(appEnv.PAPERS_BUCKET, paper.id);
  const result = streamText({
    model: getChatModel(appEnv),
    instructions,
    messages: modelMessages,
    tools,
    stopWhen: isStepCount(8),
    maxOutputTokens: 4096,
    // OpenRouter 服务端网页搜索（Exa 支撑），与本地 tools 不冲突；
    // 引用在 providerMetadata.openrouter.annotations
    providerOptions: {
      openrouter: {
        plugins: [{ id: "web", max_results: 5 }],
      },
    },
  });

  const uiStream = toUIMessageStream({
    stream: result.stream,
    tools,
    originalMessages: uiMessages,
    // OpenRouter 的网页搜索引用是 source part，默认不下发就全丢了
    sendSources: true,
    // 必须显式给：没有它时响应消息的 id 会是空串（originalMessages 最后一条是
    // user，SDK 只在续写 assistant 消息时复用其 id），落库会撞主键。
    generateMessageId: () => crypto.randomUUID(),
    // 返回值会作为 error part 下发给客户端，给稳定 code 而不是原始报错文案
    // （默认实现返回 "An error occurred."，且会泄露服务端错误细节的风险）
    onError: (error) => {
      console.error("[chat] stream error:", error);
      return "stream_failed";
    },
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

  return createUIMessageStreamResponse({
    stream: uiStream,
    // 客户端断开也要落库助手消息。consumeSseStream 拿到的是 handleUIMessageStreamFinish
    // 之后 tee 出来的独立分支，响应体那一路被 cancel 不会波及它，所以 onEnd 能拿到
    // 完整的助手消息而不是截断的。必须用 waitUntil 托住：浮动 promise 在响应结束后
    // 会被 Workers 运行时回收。
    consumeSseStream: ({ stream }) => {
      waitUntil(consumeStream({ stream }));
    },
  });
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: handler,
    },
  },
});
