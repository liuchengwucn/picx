import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import type * as schema from "#/db/schema";
import {
  conversationMembers,
  conversationMessages,
  conversations,
  userProfiles,
} from "#/db/schema";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";
import { protectedProcedure, router } from "../init";

const PROFILE_MAX_CHARS = 4000;

type Db = DrizzleD1Database<typeof schema>;

/**
 * 会话归属校验：当前用户必须是成员。返回会话行，否则抛 NOT_FOUND。
 * 本期 type 恒为 'agent'，membership 就是 owner 本人；将来 channel 复用同一检查。
 */
async function loadMyConversation(
  db: Db,
  conversationId: string,
  userId: string,
) {
  const [row] = await db
    .select({ conversation: conversations })
    .from(conversations)
    .innerJoin(
      conversationMembers,
      and(
        eq(conversationMembers.conversationId, conversations.id),
        eq(conversationMembers.userId, userId),
      ),
    )
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return row.conversation;
}

// review-guest 豁免（同 chatRouter 的理由，见 src/integrations/trpc/routers/chat.ts 顶部注释）：
// 会话 CRUD 是 agent 聊天的前置，禁写会让演示模式下 assistant 完全不可用。建会话本身
// 不受限流（限流只作用于发消息），但一个空会话不产生任何模型开销，没有实际滥用面。
// 唯一例外是 updateProfile：guest 只读态下（isReviewGuestReadOnlySession）禁写，
// 否则共享账号的档案会被所有访客互相污染。
export const assistantRouter = router({
  listConversations: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: conversations.id,
        title: conversations.title,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, conversations.id),
          eq(conversationMembers.userId, ctx.session.user.id),
        ),
      )
      .orderBy(desc(conversations.updatedAt));
  }),

  createConversation: protectedProcedure.mutation(async ({ ctx }) => {
    const id = crypto.randomUUID();
    const userId = ctx.session.user.id;
    // D1 无事务，但 batch 是原子的：会话行与成员行要么都写要么都不写
    await ctx.db.batch([
      ctx.db
        .insert(conversations)
        .values({ id, type: "agent", createdBy: userId }),
      ctx.db
        .insert(conversationMembers)
        .values({ conversationId: id, userId, role: "owner" }),
    ]);
    const [row] = await ctx.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    return row;
  }),

  // UIMessage 形状，直接喂 useChat 的 initialMessages
  getMessages: protectedProcedure
    .input(z.object({ conversationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await loadMyConversation(
        ctx.db,
        input.conversationId,
        ctx.session.user.id,
      );
      const rows = await ctx.db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, input.conversationId))
        .orderBy(conversationMessages.createdAt, conversationMessages.id);
      return rows.map((r) => ({
        id: r.id,
        role: r.senderType,
        parts: r.parts,
      }));
    }),

  renameConversation: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().min(1),
        title: z.string().min(1).max(80),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadMyConversation(
        ctx.db,
        input.conversationId,
        ctx.session.user.id,
      );
      await ctx.db
        .update(conversations)
        .set({ title: input.title, updatedAt: new Date() })
        .where(eq(conversations.id, input.conversationId));
      return { ok: true };
    }),

  deleteConversation: protectedProcedure
    .input(z.object({ conversationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await loadMyConversation(
        ctx.db,
        input.conversationId,
        ctx.session.user.id,
      );
      // D1 无事务：先删子表再删主表，中断时会话仍在、可重删，不留孤儿行
      await ctx.db
        .delete(conversationMessages)
        .where(eq(conversationMessages.conversationId, input.conversationId));
      await ctx.db
        .delete(conversationMembers)
        .where(eq(conversationMembers.conversationId, input.conversationId));
      await ctx.db
        .delete(conversations)
        .where(eq(conversations.id, input.conversationId));
      return { ok: true };
    }),

  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, ctx.session.user.id))
      .limit(1);
    return row ?? null;
  }),

  updateProfile: protectedProcedure
    .input(z.object({ content: z.string().max(PROFILE_MAX_CHARS) }))
    .mutation(async ({ ctx, input }) => {
      if (isReviewGuestReadOnlySession(ctx.session)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Review guest mode is read-only",
        });
      }
      await ctx.db
        .insert(userProfiles)
        .values({ userId: ctx.session.user.id, content: input.content })
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: { content: input.content, updatedAt: new Date() },
        });
      return { ok: true };
    }),
});
