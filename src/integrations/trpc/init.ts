import { env } from "cloudflare:workers";
import { initTRPC, TRPCError } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { drizzle } from "drizzle-orm/d1";
import superjson from "superjson";
import * as schema from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  getReviewGuestServerSession,
  isReviewGuestModeEnabled,
} from "#/lib/review-guest";

export interface PaperQueueMessage {
  paperId: string;
  userId: string;
  type?: "initial" | "mineru_poll" | "regenerate_whiteboard"; // 消息类型，默认为 initial
  sourceType?: "upload" | "arxiv"; // regenerate_whiteboard / mineru_poll 不需要
  arxivUrl?: string;
  r2Key?: string;
  language?: "en" | "zh-cn" | "zh-tw" | "ja";
  whiteboardLanguage?: "en" | "zh-cn" | "zh-tw" | "ja";
  extraLanguages?: ("zh-cn" | "zh-tw" | "ja")[]; // 额外翻译语言
  apiConfigId?: string;
  promptId?: string;
  /** 是否生成 whiteboard。用户上传默认 false；HF cron 传 true。 */
  generateWhiteboard?: boolean;
  /** mineru_poll 专用：MinerU 批次 id（也落库在 papers.mineru_batch_id）。 */
  mineruBatchId?: string;
  /** mineru_poll 专用：提交 MinerU 的 epoch ms，用于 20 分钟总超时判定。 */
  mineruSubmittedAt?: number;
  /** mineru_poll 专用：第几次延迟轮询，仅用于日志。 */
  mineruPollAttempt?: number;
}

interface AppEnvBindings {
  DB: D1Database;
  PAPER_QUEUE: Queue<PaperQueueMessage>;
  PAPERS_BUCKET: R2Bucket;
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  GEMINI_API_KEY: string;
  GEMINI_BASE_URL?: string;
  GEMINI_MODEL?: string;
  CF_API_TOKEN?: string;
  API_KEY_ENCRYPTION_SECRET: string;
  MINERU_TOKEN?: string;
  INDEXNOW_KEY?: string;
  // Gallery 方向化（direction digest）
  DIGEST_WORKFLOW: Workflow;
  DIGEST_CHEAP_MODEL?: string; // 扫源初筛/精读/对抗投票，回落 OPENAI_MODEL
  DIGEST_STRONG_MODEL?: string; // Scope 分解/定稿，回落 OPENAI_MODEL
}

export async function createTRPCContext(opts: FetchCreateContextFnOptions) {
  const appEnv = env as typeof env & AppEnvBindings;
  return {
    auth,
    headers: opts.req.headers,
    env: appEnv,
    db: drizzle(appEnv.DB, { schema }),
  };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createTRPCRouter = t.router;

const isAuthed = t.middleware(async ({ ctx, next }) => {
  const session =
    (await ctx.auth.api.getSession({ headers: ctx.headers })) ??
    (isReviewGuestModeEnabled()
      ? await getReviewGuestServerSession(ctx.db)
      : null);

  if (!session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be logged in to access this resource",
    });
  }

  return next({
    ctx: {
      ...ctx,
      session,
    },
  });
});

export const protectedProcedure = t.procedure.use(isAuthed);
