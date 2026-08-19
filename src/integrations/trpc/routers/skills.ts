import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { assistantSkills } from "#/db/schema";
import {
  BUILTIN_SKILLS,
  BUILTIN_TIMESTAMP,
  builtinIdOf,
  findBuiltinById,
  isBuiltinId,
} from "#/lib/builtin-skills";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";
import {
  mergeBuiltinSkills,
  SKILL_LIMITS,
  skillInputSchema,
} from "#/lib/skills";
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
 * 深度加上限：防止（理论上的）循环 cause 引用导致死循环。
 */
const MAX_CAUSE_CHAIN_DEPTH = 10;

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_CHAIN_DEPTH; depth++) {
    if (!(current instanceof Error)) return false;
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
  // 内置行排最前：它们存在的理由就是引导可见性。注意与 catalog 的顺序相反。
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: assistantSkills.id,
        name: assistantSkills.name,
        description: assistantSkills.description,
        enabled: assistantSkills.enabled,
        updatedAt: assistantSkills.updatedAt,
        // 单表查询，插值 Column 会被渲染成裸列名 `length("body")`——正是想要的。
        // 清单页只显示规模，正文本身仍然只有 get 才拉。
        bodyChars: sql<number>`length(${assistantSkills.body})`.mapWith(Number),
      })
      .from(assistantSkills)
      .where(eq(assistantSkills.userId, ctx.session.user.id))
      .orderBy(desc(assistantSkills.updatedAt));
    const userRows = rows.map((row) => ({ ...row, builtin: false }));
    const { builtin } = mergeBuiltinSkills(userRows, BUILTIN_SKILLS);
    const builtinRows = builtin.map((skill) => ({
      id: builtinIdOf(skill.name),
      name: skill.name,
      description: skill.description,
      enabled: true,
      updatedAt: BUILTIN_TIMESTAMP,
      bodyChars: skill.body.length,
      builtin: true,
    }));
    return [...builtinRows, ...userRows];
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // 形状必须与真实行一致，否则编辑页要为内置行分叉
      const builtin = findBuiltinById(input.id);
      if (builtin) {
        return {
          id: input.id,
          userId: ctx.session.user.id,
          name: builtin.name,
          description: builtin.description,
          body: builtin.body,
          enabled: true,
          createdAt: BUILTIN_TIMESTAMP,
          updatedAt: BUILTIN_TIMESTAMP,
        };
      }
      if (isBuiltinId(input.id)) throw new TRPCError({ code: "NOT_FOUND" });
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
      const userId = ctx.session.user.id;
      const builtin = findBuiltinById(id);
      if (builtin) {
        // 实体化：内置行第一次被写就落成一条普通用户行，此后走全部现有路径。
        // 不查 maxPerUser 配额——否则满 50 条的用户会关不掉内置 skill。
        // patch 里 zod optional 未传的键根本不存在（不是 undefined），
        // 所以 `...patch` 展开不会把下面的默认值抹成 undefined。
        const newId = crypto.randomUUID();
        try {
          await ctx.db.insert(assistantSkills).values({
            id: newId,
            userId,
            name: builtin.name,
            description: builtin.description,
            body: builtin.body,
            enabled: true,
            ...patch,
          });
          return { id: newId };
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          // 显式改名撞上了另一条已存在的 skill：必须跟普通 update 路径一样报冲突。
          // 否则会把内置正文写进用户那条同名 skill 里，静默吞掉他的内容。
          if (patch.name && patch.name !== builtin.name) {
            throw new TRPCError({ code: "CONFLICT", message: "name taken" });
          }
          // 到这里只可能是并发双击开关：撞的是刚刚自己插进去的那行，退化为更新
          const [existing] = await ctx.db
            .select({ id: assistantSkills.id })
            .from(assistantSkills)
            .where(
              and(
                eq(assistantSkills.userId, userId),
                eq(assistantSkills.name, builtin.name),
              ),
            )
            .limit(1);
          if (!existing) {
            throw new TRPCError({ code: "CONFLICT", message: "name taken" });
          }
          await ctx.db
            .update(assistantSkills)
            .set({ ...patch, updatedAt: new Date() })
            .where(
              and(
                eq(assistantSkills.id, existing.id),
                eq(assistantSkills.userId, userId),
              ),
            );
          return { id: existing.id };
        }
      }
      if (isBuiltinId(id)) throw new TRPCError({ code: "NOT_FOUND" });
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
          .where(
            and(
              eq(assistantSkills.id, id),
              eq(assistantSkills.userId, ctx.session.user.id),
            ),
          );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({ code: "CONFLICT", message: "name taken" });
        }
        throw error;
      }
      return { id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      assertWritable(ctx.session);
      // 内置行没有实体，删无可删；用户想去掉它就关掉开关（会实体化成 disabled 行）
      if (isBuiltinId(input.id)) throw new TRPCError({ code: "NOT_FOUND" });
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
        .where(
          and(
            eq(assistantSkills.id, input.id),
            eq(assistantSkills.userId, ctx.session.user.id),
          ),
        );
      return { ok: true };
    }),
});
