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
// intro 只有 1-3 句四语，比整篇简报翻译（translateDigest 走的也是 cheap）轻得多，
// 而这又是站长按一次付一次的按钮 —— 没有理由上强模型
import { cheapModel } from "#/lib/digest/llm";
import { adminProcedure, router } from "../init";

const localeRecord = z.record(
  z.enum(["en", "zh-cn", "zh-tw", "ja"]),
  z.string().min(1),
);

/**
 * config 是原样喂给适配器的 JSON，字段是并集（每个适配器只用其中一部分），所以
 * 单条字段只能是 optional，「哪些是必填」得看 adapterType —— 见下面 upsertSourceInput
 * 的跨字段校验。
 *
 * 默认的 strip 语义（不要改成 passthrough）是这里的第一道防线：字段名拼错（`ur`）
 * 会被静默剥掉，剥掉之后必填项就缺了，正好被跨字段校验抓住。
 */
const sourceConfig = z.object({
  query: z.string().optional(),
  maxResults: z.number().int().positive().optional(),
  url: z.string().url().optional(),
});

/**
 * 源的必填项按 adapterType 分叉，而适配器那边是硬要求（sources.ts 里 arxiv_query
 * 缺 query、rss 缺 url 都直接 throw）。不在保存这一刻拦住的代价被周更节奏放大：
 * 错配的源要等到周六 workflow 跑才失败一次，consecutiveFailures 每周 +1，好几周
 * 才熔断，管理页期间只显示「连续失败 1 次」。
 *
 * 校验挂在整个 input 上而不是 sourceConfig 上：adapterType 与 config 是兄弟字段，
 * 单独的 config schema 看不见 adapterType。
 *
 * 只校验「该有的有没有」，不管多出来的：切换适配器类型后 config 里残留的无关字段
 * （rss 源里还留着 query）是无害残留，拦住它会让站长改不动配置。
 */
const upsertSourceInput = z
  .object({
    id: z.string().optional(),
    directionId: z.string(),
    adapterType: z.enum(["arxiv_query", "rss"]),
    config: sourceConfig,
    enabled: z.boolean(),
  })
  .superRefine((input, ctx) => {
    if (input.adapterType === "arxiv_query" && !input.config.query?.trim())
      ctx.addIssue({
        code: "custom",
        path: ["config", "query"],
        message: "arxiv_query source requires a non-empty config.query",
      });
    // url 的合法性已由 sourceConfig 的 .url() 管；这里只补「必须有」
    if (input.adapterType === "rss" && !input.config.url)
      ctx.addIssue({
        code: "custom",
        path: ["config", "url"],
        message: "rss source requires config.url",
      });
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
    .input(upsertSourceInput)
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
          cheapModel(ctx.env),
          adopted.focusBrief,
        );
        await setDirectionIntro(ctx.db, adopted.directionId, intro);
        introUpdated = true;
      } catch (e) {
        console.error("[admin] intro regeneration after adopt failed:", e);
      }
      // supersededCount > 0：同方向其余基于旧 brief 的全量重写已被连带作废，
      // 前端应当明确提示，别让站长以为它们还在队列里
      return { introUpdated, supersededCount: adopted.supersededCount };
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
      return { ok: true };
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
        cheapModel(ctx.env),
        dir.focusBrief,
      );
      await setDirectionIntro(ctx.db, input.directionId, intro);
      return { intro };
    }),

  triggerDigest: adminProcedure
    .input(z.object({ directionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [dir] = await ctx.db
        .select({ slug: directions.slug, isActive: directions.isActive })
        .from(directions)
        .where(eq(directions.id, input.directionId))
        .limit(1);
      if (!dir) throw new TRPCError({ code: "NOT_FOUND" });
      /**
       * 停用的方向不许起飞。这是权威判定（前端那个灰按钮只是为了讲清原因）：
       *
       * 1. deleteDirectionGuarded 的 still_active 守卫押在「停用即无新实例起飞」上，
       *    此处放行等于给它开第二条跑道 —— 对一个已停用、无历史的方向点「立即开一期」，
       *    再在 ensureDigestShell 落行之前点删除，两个 COUNT 都是 0、still_active 也过，
       *    DELETE 成功；在飞的实例随后往已消失的 digest 插子行、撞外键重试到耗尽。
       * 2. 停用方向的期在公开侧一律不可见（store.ts 的公开查询全是 isActive-only），
       *    整条 workflow（强模型 scope + 精读 + 三票对抗 + 四语翻译）跑完、发布，
       *    却没有任何入口能看到产物 —— 静默烧钱。
       */
      if (!dir.isActive)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "direction not active",
        });
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
