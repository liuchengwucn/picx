import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { directions } from "#/db/schema";
import {
  adoptFocusUpdateStore,
  deleteDirectionGuarded,
  deleteSource,
  dismissFocusUpdateStore,
  listDirectionsAdmin,
  listPendingProposals,
  listRecentDigestsAdmin,
  listRecentFeedbackAdmin,
  reviveSource,
  setDirectionIntro,
  upsertDirection,
  upsertSource,
} from "#/lib/digest/admin-store";
import { generateDirectionIntro } from "#/lib/digest/ai";
import { strongModel } from "#/lib/digest/llm";
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

  // 刻意不把 not_found 翻成 TRPCError（与 upsertDirection/upsertSource 相反）：
  // 三个 reason（not_found / has_history / still_active）都是 UI 必须逐条解释的
  // 正常态，做成返回值前端一次 switch 就够，不用去 catch 里辨认 code。
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

  /** 待审的 focusBrief 演化提案（定稿时由强模型顺带产出，人工采纳/驳回） */
  listProposals: adminProcedure.query(({ ctx }) =>
    listPendingProposals(ctx.db),
  ),

  adoptFocusUpdate: adminProcedure
    .input(z.object({ digestId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const adopted = await adoptFocusUpdateStore(ctx.db, input.digestId);
      if (!adopted)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "proposal not pending",
        });
      // 简介刷新是 best-effort：focusBrief 已经生效，翻译失败不回滚采纳（回滚等于
      // 丢掉这次演化），只把 introUpdated=false 交给前端，管理员可用「生成简介」重试
      let introUpdated = false;
      try {
        const intro = await generateDirectionIntro(
          strongModel(ctx.env),
          adopted.focusBrief,
        );
        await setDirectionIntro(ctx.db, adopted.directionId, intro);
        introUpdated = true;
      } catch (e) {
        console.error("[admin] intro regeneration after adopt failed:", e);
      }
      return { introUpdated };
    }),

  dismissFocusUpdate: adminProcedure
    .input(z.object({ digestId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await dismissFocusUpdateStore(ctx.db, input.digestId);
      if (!ok)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "proposal not pending",
        });
      return { ok };
    }),

  /** 手动重生成四语公开简介（采纳时的自动刷新失败后的补救入口） */
  generateIntro: adminProcedure
    .input(z.object({ directionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [dir] = await ctx.db
        .select({ focusBrief: directions.focusBrief })
        .from(directions)
        .where(eq(directions.id, input.directionId))
        .limit(1);
      if (!dir) throw new TRPCError({ code: "NOT_FOUND" });
      const intro = await generateDirectionIntro(
        strongModel(ctx.env),
        dir.focusBrief,
      );
      await setDirectionIntro(ctx.db, input.directionId, intro);
      return { intro };
    }),

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
