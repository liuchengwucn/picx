import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { creditTransactions, paperResults, papers, user } from "#/db/schema";
import type { AIConfig } from "#/lib/ai";
import { translateSummary } from "#/lib/ai";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";
import { protectedProcedure, publicProcedure, router } from "../init";

function assertGuestWriteAllowed(session: { user: { id: string } }) {
  if (isReviewGuestReadOnlySession(session)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Review guest mode is read-only",
    });
  }
}

export const paperRouter = router({
  /**
   * Create a new paper processing task
   * Deducts 1 credit from user and creates paper record
   */
  create: protectedProcedure
    .input(
      z.object({
        sourceType: z.enum(["upload", "arxiv"]),
        arxivUrl: z.string().url().optional(),
        filename: z.string().min(1).max(255),
        fileSize: z
          .number()
          .int()
          .min(0) // Allow 0 for arxiv (will be updated after download)
          .max(50 * 1024 * 1024), // 50MB
        r2Key: z.string().min(1),
        language: z.enum(["en", "zh-CN", "zh-TW", "ja"]).optional(), // 摘要语言
        whiteboardLanguage: z.enum(["en", "zh-cn", "zh-tw", "ja"]).optional(), // 白板图语言
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);
      let paper: typeof papers.$inferSelect;

      // D1 不支持事务，所以直接执行操作
      // 注意：这不是原子的，但 D1 的限制
      try {
        // Better Auth 已经管理用户，直接使用 session 中的 user ID
        const userId = ctx.session.user.id;

        // 先扣除积分，使用条件更新确保积分足够
        const [updatedUser] = await ctx.db
          .update(user)
          .set({
            credits: sql`${user.credits} - 1`,
          })
          .where(and(eq(user.id, userId), sql`${user.credits} >= 1`))
          .returning();

        // 如果没有更新任何行，说明积分不足
        if (!updatedUser) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Insufficient credits. You need at least 1 credit.",
          });
        }

        // 创建论文记录
        const [newPaper] = await ctx.db
          .insert(papers)
          .values({
            userId: userId,
            title: input.filename,
            sourceType: input.sourceType,
            sourceUrl: input.arxivUrl,
            pdfR2Key: input.r2Key,
            fileSize: input.fileSize,
            status: "pending",
          })
          .returning();

        // 记录积分交易
        await ctx.db.insert(creditTransactions).values({
          userId: userId,
          amount: -1,
          type: "consume",
          relatedPaperId: newPaper.id,
          description: "Paper processing",
        });

        paper = newPaper;
      } catch (error) {
        // 如果是我们抛出的 TRPCError，直接重新抛出
        if (error instanceof TRPCError) {
          throw error;
        }
        // 其他错误包装为 INTERNAL_SERVER_ERROR
        console.error("Failed to create paper:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create paper",
          cause: error,
        });
      }

      // 推送到队列进行异步处理
      try {
        // 将 Paraglide 的语言代码映射为 AI 函数使用的语言代码
        const queueLanguage: "en" | "zh-cn" | "zh-tw" | "ja" | undefined =
          input.language
            ? input.language === "zh-CN"
              ? "zh-cn"
              : input.language === "zh-TW"
                ? "zh-tw"
                : input.language
            : undefined;

        const queueWhiteboardLanguage: "en" | "zh-cn" | "zh-tw" | "ja" =
          input.whiteboardLanguage || "en";

        await ctx.env.PAPER_QUEUE.send({
          paperId: paper.id,
          userId: ctx.session.user.id,
          sourceType: input.sourceType,
          arxivUrl: input.arxivUrl,
          r2Key: input.r2Key,
          language: queueLanguage,
          whiteboardLanguage: queueWhiteboardLanguage,
        });
      } catch (error) {
        await ctx.db
          .update(papers)
          .set({
            status: "failed",
            errorMessage: "Queue dispatch failed",
          })
          .where(eq(papers.id, paper.id));

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Paper created but queue dispatch failed",
          cause: error,
        });
      }

      return { paperId: paper.id, status: paper.status };
    }),

  /**
   * List user's papers with pagination
   */
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
        status: z
          .enum([
            "pending",
            "processing_text",
            "processing_image",
            "completed",
            "failed",
          ])
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.limit;

      const conditions = [
        eq(papers.userId, ctx.session.user.id),
        isNull(papers.deletedAt),
      ];

      if (input.status) {
        conditions.push(eq(papers.status, input.status));
      }

      const paperList = await ctx.db
        .select()
        .from(papers)
        .where(and(...conditions))
        .orderBy(desc(papers.createdAt))
        .limit(input.limit)
        .offset(offset);

      const [totalResult] = await ctx.db
        .select({ count: count() })
        .from(papers)
        .where(and(...conditions));

      return {
        papers: paperList,
        total: totalResult.count,
      };
    }),

  /**
   * Get paper by ID with results
   */
  getById: protectedProcedure
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(and(eq(papers.id, input), isNull(papers.deletedAt)))
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      // Check permission: owner or public paper
      if (paper.userId !== ctx.session.user.id && !paper.isPublic) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to view this paper",
        });
      }

      // 获取结果（如果有）
      const [result] = await ctx.db
        .select()
        .from(paperResults)
        .where(eq(paperResults.paperId, input))
        .limit(1);

      // 如果有结果，返回当前语言的摘要
      if (result) {
        const summaries = result.summaries as Record<string, string>;
        const currentLanguage = result.summaryLanguage;
        const summary = summaries[currentLanguage] || summaries.en || "";

        return {
          paper,
          result: {
            ...result,
            summary, // 返回当前语言的摘要
            availableLanguages: Object.keys(summaries), // 返回可用的语言列表
          },
        };
      }

      return {
        paper,
        result: null,
      };
    }),

  /**
   * Soft delete a paper
   */
  delete: protectedProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);
      const result = await ctx.db
        .update(papers)
        .set({ deletedAt: new Date() })
        .where(
          and(eq(papers.id, input), eq(papers.userId, ctx.session.user.id)),
        )
        .returning();

      if (result.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      return { success: true };
    }),

  /**
   * Regenerate summary in a different language
   * Does NOT deduct credits - just translates existing summary
   * Caches translations so switching back doesn't require re-translation
   */
  regenerateSummary: protectedProcedure
    .input(
      z.object({
        paperId: z.string().uuid(),
        language: z.enum(["en", "zh-cn", "zh-tw", "ja"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);
      const userId = ctx.session.user.id;

      // Step 1: Check if paper exists and belongs to user
      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(
          and(
            eq(papers.id, input.paperId),
            eq(papers.userId, userId),
            isNull(papers.deletedAt),
          ),
        )
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      // Step 2: Check if paper is completed
      if (paper.status !== "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paper processing is not completed yet",
        });
      }

      // Step 3: Get existing result
      const [existingResult] = await ctx.db
        .select()
        .from(paperResults)
        .where(eq(paperResults.paperId, input.paperId))
        .limit(1);

      if (!existingResult) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper results not found",
        });
      }

      const summaries = existingResult.summaries as Record<string, string>;

      // Step 4: Check if target language already exists
      if (summaries[input.language]) {
        // Language already exists, just update the current language
        await ctx.db
          .update(paperResults)
          .set({
            summaryLanguage: input.language,
          })
          .where(eq(paperResults.paperId, input.paperId));

        return {
          success: true,
          summary: summaries[input.language],
          language: input.language,
          cached: true,
        };
      }

      // Step 5: Translate from current language to target language
      const currentLanguage = existingResult.summaryLanguage;
      const sourceSummary = summaries[currentLanguage];

      if (!sourceSummary) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Source summary not found",
        });
      }

      const aiConfig: AIConfig = {
        openaiApiKey: ctx.env.OPENAI_API_KEY,
        openaiBaseUrl: ctx.env.OPENAI_BASE_URL,
        openaiModel: ctx.env.OPENAI_MODEL,
        geminiApiKey: ctx.env.GEMINI_API_KEY,
        geminiBaseUrl: ctx.env.GEMINI_BASE_URL,
        geminiModel: ctx.env.GEMINI_MODEL,
        cfApiToken: ctx.env.CF_API_TOKEN,
      };

      const translatedSummary = await translateSummary(
        sourceSummary,
        input.language,
        aiConfig,
      );

      // Step 6: Save the new translation and update current language
      const updatedSummaries = {
        ...summaries,
        [input.language]: translatedSummary,
      };

      await ctx.db
        .update(paperResults)
        .set({
          summaries: updatedSummaries,
          summaryLanguage: input.language,
        })
        .where(eq(paperResults.paperId, input.paperId));

      return {
        success: true,
        summary: translatedSummary,
        language: input.language,
        cached: false,
      };
    }),

  /**
   * Toggle paper public status
   * Only owner can toggle, and paper must be completed with whiteboard
   */
  togglePublic: protectedProcedure
    .input(z.object({ paperId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);
      const userId = ctx.session.user.id;

      // Check if paper exists and belongs to user
      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(
          and(
            eq(papers.id, input.paperId),
            eq(papers.userId, userId),
            isNull(papers.deletedAt),
          ),
        )
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      // Check if paper is completed
      if (paper.status !== "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paper must be completed before sharing",
        });
      }

      // Check if whiteboard image exists
      const [result] = await ctx.db
        .select()
        .from(paperResults)
        .where(eq(paperResults.paperId, input.paperId))
        .limit(1);

      if (!result?.whiteboardImageR2Key) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paper must have whiteboard image before sharing",
        });
      }

      // Toggle public status
      const newIsPublic = !paper.isPublic;
      const [updatedPaper] = await ctx.db
        .update(papers)
        .set({
          isPublic: newIsPublic,
          isListedInGallery: newIsPublic ? paper.isListedInGallery : false,
          publishedAt:
            newIsPublic && paper.isListedInGallery ? paper.publishedAt : null,
        })
        .where(eq(papers.id, input.paperId))
        .returning();

      return {
        success: true,
        isPublic: updatedPaper.isPublic,
        isListedInGallery: updatedPaper.isListedInGallery,
      };
    }),

  /**
   * Toggle paper gallery listing status
   * Only owner can toggle after paper is public and completed with whiteboard
   */
  toggleGalleryListing: protectedProcedure
    .input(z.object({ paperId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);
      const userId = ctx.session.user.id;

      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(
          and(
            eq(papers.id, input.paperId),
            eq(papers.userId, userId),
            isNull(papers.deletedAt),
          ),
        )
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      if (!paper.isPublic) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paper must be public before listing in gallery",
        });
      }

      if (paper.status !== "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paper must be completed before listing in gallery",
        });
      }

      const [result] = await ctx.db
        .select()
        .from(paperResults)
        .where(eq(paperResults.paperId, input.paperId))
        .limit(1);

      if (!result?.whiteboardImageR2Key) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paper must have whiteboard image before listing in gallery",
        });
      }

      const newIsListedInGallery = !paper.isListedInGallery;
      const [updatedPaper] = await ctx.db
        .update(papers)
        .set({
          isListedInGallery: newIsListedInGallery,
          publishedAt: newIsListedInGallery ? new Date() : null,
        })
        .where(eq(papers.id, input.paperId))
        .returning();

      return {
        success: true,
        isPublic: updatedPaper.isPublic,
        isListedInGallery: updatedPaper.isListedInGallery,
      };
    }),

  /**
   * List public papers for gallery
   * Accessible by everyone (no auth required)
   */
  listPublic: publicProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.limit;

      // Query public papers with results
      const publicPapers = await ctx.db
        .select({
          id: papers.id,
          title: papers.title,
          publishedAt: papers.publishedAt,
          whiteboardImageR2Key: paperResults.whiteboardImageR2Key,
        })
        .from(papers)
        .innerJoin(paperResults, eq(papers.id, paperResults.paperId))
        .where(
          and(
            eq(papers.isPublic, true),
            eq(papers.isListedInGallery, true),
            eq(papers.status, "completed"),
            isNull(papers.deletedAt),
          ),
        )
        .orderBy(desc(papers.publishedAt))
        .limit(input.limit)
        .offset(offset);

      const [totalResult] = await ctx.db
        .select({ count: count() })
        .from(papers)
        .where(
          and(
            eq(papers.isPublic, true),
            eq(papers.isListedInGallery, true),
            eq(papers.status, "completed"),
            isNull(papers.deletedAt),
          ),
        );

      return {
        papers: publicPapers,
        total: totalResult.count,
      };
    }),
});
