import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { initTRPC, TRPCError } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { auth } from "#/lib/auth";
import * as schema from "#/db/schema";

export interface PaperQueueMessage {
  paperId: string;
  userId: string;
  sourceType: "upload" | "arxiv";
  arxivUrl?: string;
  r2Key: string;
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

// Authentication middleware
const isAuthed = t.middleware(async ({ ctx, next }) => {
  const session = await ctx.auth.api.getSession({ headers: ctx.headers });
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

// Protected procedure with authentication
export const protectedProcedure = t.procedure.use(isAuthed);
