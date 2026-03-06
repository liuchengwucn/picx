import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { creditTransactions, paperResults, papers, user } from "#/db/schema";
import { protectedProcedure, router } from "../init";
import type { AIConfig } from "#/lib/ai";
import { generateSummary } from "#/lib/ai";
import { extractPDFText } from "#/lib/pdf";

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
      }),
    )
    .mutation(async ({ ctx, input }) => {
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
          description: "处理论文",
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
        await ctx.env.PAPER_QUEUE.send({
          paperId: paper.id,
          userId: ctx.session.user.id,
          sourceType: input.sourceType,
          arxivUrl: input.arxivUrl,
          r2Key: input.r2Key,
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
        .where(
          and(
            eq(papers.id, input),
            eq(papers.userId, ctx.session.user.id),
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

      // 获取结果（如果有）
      const [result] = await ctx.db
        .select()
        .from(paperResults)
        .where(eq(paperResults.paperId, input))
        .limit(1);

      return {
        paper,
        result: result || null,
      };
    }),

  /**
   * Soft delete a paper
   */
  delete: protectedProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
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
   * Deducts 1 credit from user
   */
  regenerateSummary: protectedProcedure
    .input(
      z.object({
        paperId: z.string().uuid(),
        language: z.enum(["en", "zh"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
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

      // Step 3: Deduct credit before regenerating summary
      const [updatedUser] = await ctx.db
        .update(user)
        .set({
          credits: sql`${user.credits} - 1`,
        })
        .where(and(eq(user.id, userId), sql`${user.credits} >= 1`))
        .returning();

      // If no rows updated, insufficient credits
      if (!updatedUser) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Insufficient credits. You need at least 1 credit.",
        });
      }

      // Step 4: Get PDF from R2 and extract text
      const pdfObject = await ctx.env.PAPERS_BUCKET.get(paper.pdfR2Key);
      if (!pdfObject) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "PDF file not found in storage",
        });
      }

      const pdfBuffer = await pdfObject.arrayBuffer();
      const { text } = await extractPDFText(pdfBuffer);

      if (!text || text.trim().length === 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to extract text from PDF",
        });
      }

      // Step 5: Generate new summary with specified language
      const aiConfig: AIConfig = {
        openaiApiKey: ctx.env.OPENAI_API_KEY,
        openaiBaseUrl: ctx.env.OPENAI_BASE_URL,
        openaiModel: ctx.env.OPENAI_MODEL,
        geminiApiKey: ctx.env.GEMINI_API_KEY,
        geminiBaseUrl: ctx.env.GEMINI_BASE_URL,
        geminiModel: ctx.env.GEMINI_MODEL,
        cfApiToken: ctx.env.CF_API_TOKEN,
      };

      const newSummary = await generateSummary(text, aiConfig, input.language);

      // Step 6: Update paperResults with new summary and language
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

      await ctx.db
        .update(paperResults)
        .set({
          summary: newSummary,
          summaryLanguage: input.language,
        })
        .where(eq(paperResults.paperId, input.paperId));

      // Step 7: Record credit transaction
      await ctx.db.insert(creditTransactions).values({
        userId: userId,
        amount: -1,
        type: "consume",
        relatedPaperId: input.paperId,
        description: "重新生成摘要",
      });

      return {
        success: true,
        summary: newSummary,
        language: input.language,
      };
    }),
});
