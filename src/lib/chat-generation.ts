import type { ModelMessage, ToolSet } from "ai";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "#/db/schema";
import {
  chatMessages,
  chatSessions,
  conversationMessages,
  conversations,
} from "#/db/schema";
import { AGENT_LIMITS, buildAgentTools } from "#/lib/agent";
import { buildChatTools, CHAT_LIMITS } from "#/lib/chat";
import { CARD_REPLAY_SPEC } from "#/lib/discovery-tools";

type Db = DrizzleD1Database<typeof schema>;

/**
 * Worker 请求期打包、POST 给 ChatRunner DO 的生成任务。必须 JSON 可序列化——
 * 工具闭包、db 句柄都不能进来，DO 侧按 kind 用注册表重建。
 * instructions/modelMessages 在 Worker 侧已构建完（含历史重放窗口），DO 不再碰
 * 历史表；reasoningEffort 沿用 chatStreamBody 的枚举。
 */
interface GenerationJobBase {
  userId: string;
  locale: string;
  webSearch: boolean;
  reasoningEffort: "off" | "low" | "medium" | "high" | "xhigh";
  instructions: string;
  modelMessages: ModelMessage[];
}

export type GenerationJob =
  | (GenerationJobBase & { kind: "chat"; sessionId: string; paperId: string })
  | (GenerationJobBase & {
      kind: "agent";
      conversationId: string;
      isGuest: boolean;
    });

/** DO 侧最小 env 依赖（避免 import chat-stream 造成环）：工具重建只要这个 binding */
export interface GenerationEnv {
  PAPERS_BUCKET: R2Bucket;
}

interface GenerationSpec<TJob extends GenerationJob> {
  maxToolSteps: number;
  webSearchMaxResults: number;
  /** 落库时保留 output 的工具 part 类型；与 CARD_REPLAY_SPEC 同源（口径见 discovery-tools） */
  keepToolOutputTypes: ReadonlySet<string>;
  buildTools(job: TJob, db: Db, env: GenerationEnv): ToolSet;
  /** 落助手消息 + 会话 touch。从路由 spec 原样搬来，语义不变。 */
  persistAssistantMessage(
    db: Db,
    job: TJob,
    message: { id: string; parts: unknown[] },
  ): Promise<void>;
}

export const GENERATION_SPECS: {
  chat: GenerationSpec<Extract<GenerationJob, { kind: "chat" }>>;
  agent: GenerationSpec<Extract<GenerationJob, { kind: "agent" }>>;
} = {
  chat: {
    // 数值与 /api/chat 原 spec 一致（12 是拍的工具预算，见原路由注释）
    maxToolSteps: 12,
    webSearchMaxResults: CHAT_LIMITS.webSearchMaxResults,
    keepToolOutputTypes: CARD_REPLAY_SPEC.keepToolOutputTypes,
    buildTools: (job, db, env) =>
      buildChatTools({
        db,
        bucket: env.PAPERS_BUCKET,
        userId: job.userId,
        paperId: job.paperId,
      }),
    persistAssistantMessage: async (db, job, message) => {
      await db.insert(chatMessages).values({
        id: message.id,
        sessionId: job.sessionId,
        userId: job.userId,
        role: "assistant",
        parts: message.parts,
      });
      await db
        .update(chatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(chatSessions.id, job.sessionId));
    },
  },
  agent: {
    maxToolSteps: 10,
    webSearchMaxResults: AGENT_LIMITS.webSearchMaxResults,
    keepToolOutputTypes: CARD_REPLAY_SPEC.keepToolOutputTypes,
    buildTools: (job, db, env) =>
      buildAgentTools({
        db,
        bucket: env.PAPERS_BUCKET,
        userId: job.userId,
        locale: job.locale,
        isGuest: job.isGuest,
      }),
    persistAssistantMessage: async (db, job, message) => {
      await db.insert(conversationMessages).values({
        id: message.id,
        conversationId: job.conversationId,
        senderType: "assistant",
        senderId: null,
        parts: message.parts,
      });
      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, job.conversationId));
    },
  },
};
