import { env } from "cloudflare:workers";
import { initTRPC, TRPCError } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { auth } from "#/lib/auth";

export interface PaperQueueMessage {
	paperId: string;
	userId: string;
	sourceType: "upload" | "arxiv";
	arxivUrl?: string;
	r2Key: string;
}

interface AppEnvBindings {
	PAPER_QUEUE: Queue<PaperQueueMessage>;
}

export async function createTRPCContext(opts: FetchCreateContextFnOptions) {
	return {
		auth,
		headers: opts.req.headers,
		env: env as typeof env & AppEnvBindings,
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
