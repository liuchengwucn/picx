import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { chatMessages, chatSessions } from "#/db/schema";
import { loadAccessiblePaper } from "#/lib/chat";
import { protectedProcedure, router } from "../init";

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
