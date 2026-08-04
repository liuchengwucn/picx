import { TRPCError } from "@trpc/server";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { chatMessages, chatSessions } from "#/db/schema";
import { loadAccessiblePaper } from "#/lib/chat";
import { protectedProcedure, router } from "../init";

/** 单论文下每用户会话数硬上限：仅作防滥用兜底，正常用户不可能达到 */
const MAX_SESSIONS_PER_PAPER = 50;

// review-guest 豁免（有意，非疏漏）：其他 router 的 mutation 都会先过
// assertGuestWriteAllowed，这里没有——chatbot 本身要求写 chat_sessions/
// chat_messages，禁写会让演示模式下 chatbot 完全不可用（流式路由 /api/chat
// 同样允许 guest 发消息）。guest 共享同一 demo 账号与限流配额，滥用成本由
// checkChatRateLimit 的 30/min + 500/day 兜底，此处不再重复加 guest 写入守卫。
export const chatRouter = router({
  // 某论文下我的会话列表（新→旧）
  listSessions: protectedProcedure
    .input(z.object({ paperShortId: z.string().min(1).max(10) }))
    .query(async ({ ctx, input }) => {
      const paper = await loadAccessiblePaper(
        ctx.db,
        input.paperShortId,
        ctx.session.user.id,
      );
      if (!paper) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db
        .select({
          id: chatSessions.id,
          title: chatSessions.title,
          createdAt: chatSessions.createdAt,
          updatedAt: chatSessions.updatedAt,
        })
        .from(chatSessions)
        .where(
          and(
            eq(chatSessions.userId, ctx.session.user.id),
            eq(chatSessions.paperId, paper.id),
          ),
        )
        .orderBy(desc(chatSessions.updatedAt));
    }),

  createSession: protectedProcedure
    .input(z.object({ paperShortId: z.string().min(1).max(10) }))
    .mutation(async ({ ctx, input }) => {
      const paper = await loadAccessiblePaper(
        ctx.db,
        input.paperShortId,
        ctx.session.user.id,
      );
      if (!paper) throw new TRPCError({ code: "NOT_FOUND" });
      const [sessionCountRow] = await ctx.db
        .select({ n: count() })
        .from(chatSessions)
        .where(
          and(
            eq(chatSessions.userId, ctx.session.user.id),
            eq(chatSessions.paperId, paper.id),
          ),
        );
      if ((sessionCountRow?.n ?? 0) >= MAX_SESSIONS_PER_PAPER) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "session limit reached",
        });
      }
      const [row] = await ctx.db
        .insert(chatSessions)
        .values({ userId: ctx.session.user.id, paperId: paper.id })
        .returning();
      return row;
    }),

  // 会话历史（UIMessage 形状，直接喂 useChat 的 initialMessages）
  getMessages: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(chatSessions)
        .where(
          and(
            eq(chatSessions.id, input.sessionId),
            eq(chatSessions.userId, ctx.session.user.id),
          ),
        )
        .limit(1);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const rows = await ctx.db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, input.sessionId))
        .orderBy(chatMessages.createdAt);
      return rows.map((r) => ({ id: r.id, role: r.role, parts: r.parts }));
    }),

  deleteSession: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(chatSessions)
        .where(
          and(
            eq(chatSessions.id, input.sessionId),
            eq(chatSessions.userId, ctx.session.user.id),
          ),
        )
        .limit(1);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      // D1 无事务：先删消息再删会话，中断时留会话可重删，不留孤儿消息
      await ctx.db
        .delete(chatMessages)
        .where(eq(chatMessages.sessionId, input.sessionId));
      await ctx.db
        .delete(chatSessions)
        .where(eq(chatSessions.id, input.sessionId));
      return { ok: true };
    }),
});
