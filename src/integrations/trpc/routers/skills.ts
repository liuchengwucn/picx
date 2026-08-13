import { TRPCError } from "@trpc/server";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { assistantSkills } from "#/db/schema";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";
import { SKILL_LIMITS, skillInputSchema } from "#/lib/skills";
import { protectedProcedure, router } from "../init";

/** 写操作统一挡 review-guest（共享演示账号的 skills 不能被访客互相改写） */
function assertWritable(
  session: Parameters<typeof isReviewGuestReadOnlySession>[0],
) {
  if (isReviewGuestReadOnlySession(session)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Review guest mode is read-only",
    });
  }
}

/**
 * D1/SQLite 唯一约束冲突识别：drizzle 不给结构化错误码，只能看 message。
 * drizzle-orm 把底层驱动错误包成 DrizzleQueryError，顶层 message 固定是
 * "Failed query: ..."，真正的 "UNIQUE constraint failed" 落在 .cause 里
 * （sqlite-core/session.js 统一这样包，d1 驱动同样如此），所以要顺着 cause 链找。
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (/unique/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

const updateInputSchema = z.object({
  id: z.string().min(1),
  name: skillInputSchema.shape.name.optional(),
  description: skillInputSchema.shape.description.optional(),
  body: skillInputSchema.shape.body.optional(),
  enabled: z.boolean().optional(),
});

export const skillsRouter = router({
  // 管理页列表 + slash 选择器共用；不含 body（正文按需 get）
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        id: assistantSkills.id,
        name: assistantSkills.name,
        description: assistantSkills.description,
        enabled: assistantSkills.enabled,
        updatedAt: assistantSkills.updatedAt,
      })
      .from(assistantSkills)
      .where(eq(assistantSkills.userId, ctx.session.user.id))
      .orderBy(desc(assistantSkills.updatedAt)),
  ),

  get: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(assistantSkills)
        .where(
          and(
            eq(assistantSkills.id, input.id),
            eq(assistantSkills.userId, ctx.session.user.id),
          ),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  create: protectedProcedure
    .input(skillInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertWritable(ctx.session);
      const userId = ctx.session.user.id;
      const [row] = await ctx.db
        .select({ n: count() })
        .from(assistantSkills)
        .where(eq(assistantSkills.userId, userId));
      if ((row?.n ?? 0) >= SKILL_LIMITS.maxPerUser) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "skill limit reached",
        });
      }
      const id = crypto.randomUUID();
      try {
        await ctx.db.insert(assistantSkills).values({ id, userId, ...input });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({ code: "CONFLICT", message: "name taken" });
        }
        throw error;
      }
      return { id };
    }),

  update: protectedProcedure
    .input(updateInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertWritable(ctx.session);
      const { id, ...patch } = input;
      const [existing] = await ctx.db
        .select({ id: assistantSkills.id })
        .from(assistantSkills)
        .where(
          and(
            eq(assistantSkills.id, id),
            eq(assistantSkills.userId, ctx.session.user.id),
          ),
        )
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      try {
        await ctx.db
          .update(assistantSkills)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(assistantSkills.id, id));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({ code: "CONFLICT", message: "name taken" });
        }
        throw error;
      }
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      assertWritable(ctx.session);
      const [existing] = await ctx.db
        .select({ id: assistantSkills.id })
        .from(assistantSkills)
        .where(
          and(
            eq(assistantSkills.id, input.id),
            eq(assistantSkills.userId, ctx.session.user.id),
          ),
        )
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db
        .delete(assistantSkills)
        .where(eq(assistantSkills.id, input.id));
      return { ok: true };
    }),
});
