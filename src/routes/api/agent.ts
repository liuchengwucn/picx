import { env, waitUntil } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  isToolUIPart,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { and, count, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "#/db/schema";
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
import { auth } from "#/lib/auth";
import {
  createChatProvider,
  getChatModel,
  mapReasoningEffort,
} from "#/lib/chat";
import type { ChatErrorCode } from "#/lib/chat-errors";
import {
  getReviewGuestServerSession,
  isReviewGuestModeEnabled,
  isReviewGuestReadOnlySession,
} from "#/lib/review-guest";

/**
 * Assistant agent 的流式端点。会话创建走 tRPC assistant.createConversation，
 * 本路由要求 conversationId 已存在且当前用户是成员。
 * 错误码复用 chat-errors 码表（conversation 缺失 → session_not_found）。
 */

const bodySchema = z.object({
  conversationId: z.string().min(1),
  locale: z.string().max(10).default("en"),
  webSearch: z.boolean().default(true),
  reasoningEffort: z.enum(["off", "low", "medium", "high"]).default("off"),
  // 只收文本 part（同 /api/chat：畸形 part 落库会让会话每次重放都炸）
  message: z.object({
    id: z.string().min(1),
    role: z.literal("user"),
    parts: z
      .array(z.object({ type: z.literal("text"), text: z.string().min(1) }))
      .min(1)
      .max(32),
  }),
});

/** 保留卡片工具的 output（历史回显要重建卡片），其余对齐 /api/chat 的清洗规则 */
const CARD_TOOL_TYPES = new Set(["tool-searchArxiv", "tool-listDailyPapers"]);

function sanitizePartsForStorage(parts: UIMessage["parts"]): unknown[] {
  return parts.map((part) => {
    if (part.type === "reasoning" && part.state === "streaming") {
      return { ...part, state: "done" };
    }
    if (!isToolUIPart(part)) return part;
    if (CARD_TOOL_TYPES.has(part.type)) return part;
    const { output: _output, ...rest } = part as { output?: unknown };
    if (part.type === "tool-web_search") {
      const { input: _input, ...restWithoutInput } = rest as {
        input?: unknown;
      };
      return restWithoutInput;
    }
    return rest;
  });
}

function jsonError(code: ChatErrorCode, status: number): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
  const { conversationId, locale, message, webSearch, reasoningEffort } =
    parsed.data;

  if (textLength(message.parts) > AGENT_LIMITS.maxInputChars) {
    return jsonError("message_too_long", 413);
  }

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
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!convRow) return jsonError("session_not_found", 404);
  const conversation = convRow.conversation;

  const [msgCountRow] = await db
    .select({ n: count() })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId));
  if ((msgCountRow?.n ?? 0) >= AGENT_LIMITS.maxMessagesPerConversation) {
    return jsonError("session_full", 409);
  }

  const rate = await checkAgentRateLimit(db, userId);
  if (!rate.ok) return jsonError(rate.code, 429);

  // 历史窗口（真源 D1）：重放只带文本 part，工具输出不回喂模型（同 /api/chat）
  const historyRows = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(AGENT_LIMITS.historyWindow);
  historyRows.reverse();
  const history: UIMessage[] = historyRows
    .map((r) => ({
      id: r.id,
      role: r.senderType,
      parts: (r.parts as UIMessage["parts"]).filter((p) => p.type === "text"),
    }))
    .filter((m) => m.parts.length > 0);
  const uiMessages: UIMessage[] = [...history, message as UIMessage];

  // 先做完可能抛异常的准备工作再写库（同 /api/chat 的顺序理由）
  const [profileRow] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  const instructions = buildAgentSystemPrompt(
    profileRow?.content ?? null,
    webSearch,
  );
  const modelMessages = await convertToModelMessages(uiMessages);

  // 落用户消息（幂等 upsert，同 /api/chat：客户端提供 id，regenerate 会复用）
  await db
    .insert(conversationMessages)
    .values({
      id: message.id,
      conversationId,
      senderType: "user",
      senderId: userId,
      parts: message.parts,
    })
    .onConflictDoUpdate({
      target: conversationMessages.id,
      set: { parts: message.parts },
      // 只在冲突行确实属于本会话+本用户时才改写（SQLite DO UPDATE ... WHERE 里
      // 未加 excluded. 前缀的列指库里的原行），原理详见 /api/chat 同位置注释
      setWhere: and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.senderId, userId),
      ),
    });
  const convPatch: Partial<typeof conversations.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (!conversation.title) {
    const firstText = message.parts[0]?.text;
    if (firstText) convPatch.title = firstText.slice(0, 80);
  }
  await db
    .update(conversations)
    .set(convPatch)
    .where(eq(conversations.id, conversationId));

  const provider = createChatProvider(appEnv);
  const tools = {
    ...buildAgentTools({
      db,
      bucket: appEnv.PAPERS_BUCKET,
      userId,
      locale,
      // 与 tRPC updateProfile 同一口径：mutations 开关打开时 guest 也可写档案
      isGuest: isReviewGuestReadOnlySession(session),
    }),
    ...(webSearch
      ? {
          web_search: provider.tools.webSearch({
            maxResults: AGENT_LIMITS.webSearchMaxResults,
          }),
        }
      : {}),
  };
  const result = streamText({
    model: getChatModel(provider, appEnv),
    instructions,
    messages: modelMessages,
    tools,
    stopWhen: isStepCount(10),
    maxOutputTokens: 4096,
    providerOptions: {
      openrouter: { reasoning: mapReasoningEffort(reasoningEffort) },
    },
  });

  const uiStream = toUIMessageStream({
    stream: result.stream,
    tools,
    originalMessages: uiMessages,
    sendSources: true,
    sendReasoning: true,
    generateMessageId: () => crypto.randomUUID(),
    onError: (error) => {
      console.error("[agent] stream error:", error);
      return "stream_failed" satisfies ChatErrorCode;
    },
    onEnd: async ({ responseMessage }) => {
      try {
        await db.insert(conversationMessages).values({
          id: responseMessage.id,
          conversationId,
          senderType: "assistant",
          senderId: null,
          parts: sanitizePartsForStorage(responseMessage.parts),
        });
        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, conversationId));
      } catch (error) {
        // 落库失败不能炸流（此刻响应体可能已发完/已被取消）
        console.error("[agent] persist assistant message failed:", error);
      }
    },
  });

  return createUIMessageStreamResponse({
    stream: uiStream,
    // 断连仍落库：tee 分支 + waitUntil（原理注释见 /api/chat 同位置）
    consumeSseStream: ({ stream }) => {
      waitUntil(consumeStream({ stream }));
    },
  });
}

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: {
      POST: handler,
    },
  },
});
