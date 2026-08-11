import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { directions } from "#/db/schema";
import {
  deleteDirectionGuarded,
  deleteSource,
  listDirectionsAdmin,
  listRecentDigestsAdmin,
  listRecentFeedbackAdmin,
  reviveSource,
  upsertDirection,
  upsertSource,
} from "#/lib/digest/admin-store";
import { adminProcedure, router } from "../init";

const localeRecord = z.record(
  z.enum(["en", "zh-cn", "zh-tw", "ja"]),
  z.string().min(1),
);

const sourceConfig = z.object({
  query: z.string().optional(),
  maxResults: z.number().int().positive().optional(),
  url: z.string().url().optional(),
});

export const adminRouter = router({
  /** 管理页 mount 时的权限探针：能调通即 admin，403/401 由前端渲染 404 态 */
  whoami: adminProcedure.query(({ ctx }) => ({ userId: ctx.session.user.id })),

  listDirections: adminProcedure.query(({ ctx }) =>
    listDirectionsAdmin(ctx.db),
  ),

  upsertDirection: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        // 连字符只能做分隔符：^[a-z0-9-]+$ 会放行 "-" / "---" 这种公开 URL
        slug: z
          .string()
          .min(1)
          .max(50)
          .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
        name: localeRecord,
        focusBrief: z.string().min(1).max(8000),
        intro: localeRecord.nullish(),
        isActive: z.boolean(),
        sortOrder: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await upsertDirection(ctx.db, input);
      if ("error" in result)
        throw new TRPCError({
          code: result.error === "not_found" ? "NOT_FOUND" : "CONFLICT",
          message: result.error,
        });
      return result;
    }),

  deleteDirection: adminProcedure
    .input(z.object({ directionId: z.string() }))
    .mutation(({ ctx, input }) =>
      deleteDirectionGuarded(ctx.db, input.directionId),
    ),

  upsertSource: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        directionId: z.string(),
        adapterType: z.enum(["arxiv_query", "rss"]),
        config: sourceConfig,
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await upsertSource(ctx.db, input);
      if ("error" in result)
        throw new TRPCError({ code: "NOT_FOUND", message: result.error });
      return result;
    }),

  deleteSource: adminProcedure
    .input(z.object({ sourceId: z.string() }))
    .mutation(({ ctx, input }) => deleteSource(ctx.db, input.sourceId)),

  reviveSource: adminProcedure
    .input(z.object({ sourceId: z.string() }))
    .mutation(({ ctx, input }) => reviveSource(ctx.db, input.sourceId)),

  listRecentDigests: adminProcedure.query(({ ctx }) =>
    listRecentDigestsAdmin(ctx.db),
  ),

  listRecentFeedback: adminProcedure.query(({ ctx }) =>
    listRecentFeedbackAdmin(ctx.db),
  ),

  triggerDigest: adminProcedure
    .input(z.object({ directionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [dir] = await ctx.db
        .select({ slug: directions.slug })
        .from(directions)
        .where(eq(directions.id, input.directionId))
        .limit(1);
      if (!dir) throw new TRPCError({ code: "NOT_FOUND" });
      // cron 侧当日确定性 id 是 digest-{slug}-{yyyymmdd}（src/workers/digest-cron.ts:26），
      // 手动触发加 -m{HHmmss} 后缀避开冲突；语义 = 总是新开一期（ensureDigestShell 取 max+1）
      const now = new Date();
      const iso = now.toISOString();
      const instanceId = `digest-${dir.slug}-${iso.slice(0, 10).replaceAll("-", "")}-m${iso.slice(11, 19).replaceAll(":", "")}`;
      await ctx.env.DIGEST_WORKFLOW.create({
        id: instanceId,
        params: { directionId: input.directionId, periodEnd: iso },
      });
      return { instanceId };
    }),
});
