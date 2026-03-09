import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { whiteboardPrompts } from "#/db/schema";
import { validatePromptTemplate } from "#/lib/prompt-validation";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";
import { protectedProcedure, router } from "../init";

function assertGuestWriteAllowed(session: { user: { id: string } }) {
  if (isReviewGuestReadOnlySession(session)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Review guest mode is read-only",
    });
  }
}

export const whiteboardPromptRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const prompts = await ctx.db.query.whiteboardPrompts.findMany({
      where: eq(whiteboardPrompts.userId, ctx.session.user.id),
      orderBy: [
        desc(whiteboardPrompts.isDefault),
        asc(whiteboardPrompts.createdAt),
      ],
    });
    return prompts;
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(50),
        promptTemplate: z.string().min(10).max(3000),
        isDefault: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);

      const validation = validatePromptTemplate(input.promptTemplate);
      if (!validation.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: validation.error });
      }

      const existing = await ctx.db.query.whiteboardPrompts.findFirst({
        where: and(
          eq(whiteboardPrompts.userId, ctx.session.user.id),
          eq(whiteboardPrompts.name, input.name),
        ),
      });
      if (existing) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "whiteboard_prompt_validation_name_duplicate",
        });
      }

      if (input.isDefault) {
        await ctx.db
          .update(whiteboardPrompts)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(whiteboardPrompts.userId, ctx.session.user.id),
              eq(whiteboardPrompts.isDefault, true),
            ),
          );
      }

      const [newPrompt] = await ctx.db
        .insert(whiteboardPrompts)
        .values({
          userId: ctx.session.user.id,
          name: input.name,
          promptTemplate: input.promptTemplate,
          isDefault: input.isDefault,
        })
        .returning();

      return newPrompt;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(50).optional(),
        promptTemplate: z.string().min(10).max(3000).optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);

      const existing = await ctx.db.query.whiteboardPrompts.findFirst({
        where: and(
          eq(whiteboardPrompts.id, input.id),
          eq(whiteboardPrompts.userId, ctx.session.user.id),
        ),
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt template not found",
        });
      }

      if (input.promptTemplate) {
        const validation = validatePromptTemplate(input.promptTemplate);
        if (!validation.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: validation.error,
          });
        }
      }

      if (input.name && input.name !== existing.name) {
        const duplicate = await ctx.db.query.whiteboardPrompts.findFirst({
          where: and(
            eq(whiteboardPrompts.userId, ctx.session.user.id),
            eq(whiteboardPrompts.name, input.name),
          ),
        });
        if (duplicate) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "whiteboard_prompt_validation_name_duplicate",
          });
        }
      }

      if (input.isDefault) {
        await ctx.db
          .update(whiteboardPrompts)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(whiteboardPrompts.userId, ctx.session.user.id),
              eq(whiteboardPrompts.isDefault, true),
            ),
          );
      }

      const { id, ...updateData } = input;
      const [updated] = await ctx.db
        .update(whiteboardPrompts)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(whiteboardPrompts.id, id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);

      const existing = await ctx.db.query.whiteboardPrompts.findFirst({
        where: and(
          eq(whiteboardPrompts.id, input.id),
          eq(whiteboardPrompts.userId, ctx.session.user.id),
        ),
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt template not found",
        });
      }

      await ctx.db
        .delete(whiteboardPrompts)
        .where(eq(whiteboardPrompts.id, input.id));

      if (existing.isDefault) {
        const oldestPrompt = await ctx.db.query.whiteboardPrompts.findFirst({
          where: eq(whiteboardPrompts.userId, ctx.session.user.id),
          orderBy: asc(whiteboardPrompts.createdAt),
        });
        if (oldestPrompt) {
          await ctx.db
            .update(whiteboardPrompts)
            .set({ isDefault: true, updatedAt: new Date() })
            .where(eq(whiteboardPrompts.id, oldestPrompt.id));
        }
      }

      return { success: true };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      if (input.id) {
        const prompt = await ctx.db.query.whiteboardPrompts.findFirst({
          where: and(
            eq(whiteboardPrompts.id, input.id),
            eq(whiteboardPrompts.userId, ctx.session.user.id),
          ),
        });
        if (prompt) return prompt;
      }

      const defaultPrompt = await ctx.db.query.whiteboardPrompts.findFirst({
        where: and(
          eq(whiteboardPrompts.userId, ctx.session.user.id),
          eq(whiteboardPrompts.isDefault, true),
        ),
      });

      return defaultPrompt || null;
    }),
});
