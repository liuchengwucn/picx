import { z } from "zod";
import {
  getEditionByPeriod,
  listEditionPeriods,
} from "#/lib/digest/edition-store";
import {
  excerptFromMarkdown,
  mapEditionToLocale,
  mapIssueToLocale,
} from "#/lib/digest/present";
import {
  getDirectionDetailBySlug,
  getPublishedIssueDetail,
  listActiveDirections,
} from "#/lib/digest/store";
import { normalizeLocaleKey, pickTldr } from "#/lib/tldr";
import { publicProcedure, router } from "../init";

const localeInput = z.enum(["en", "zh-CN", "zh-TW", "ja"]).optional();
/** 合刊 URL 参数：date(period_end) 的 UTC 日期字符串 */
const periodInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const digestRouter = router({
  listDirections: publicProcedure
    .input(z.object({ locale: localeInput }))
    .query(async ({ ctx, input }) => {
      const localeKey = normalizeLocaleKey(input.locale);
      const dirs = await listActiveDirections(ctx.db);
      return dirs.map((d) => ({
        slug: d.slug,
        name: pickTldr(d.name, localeKey) ?? d.slug,
        createdAt: d.createdAt,
        latestIssue: d.latestIssue
          ? {
              issueNumber: d.latestIssue.issueNumber,
              title: pickTldr(d.latestIssue.title, localeKey) ?? "",
              publishedAt: d.latestIssue.publishedAt,
            }
          : null,
      }));
    }),

  getEdition: publicProcedure
    .input(z.object({ period: periodInput.optional(), locale: localeInput }))
    .query(async ({ ctx, input }) => {
      const edition = await getEditionByPeriod(ctx.db, input.period ?? null);
      if (!edition) return null;
      return mapEditionToLocale(edition, normalizeLocaleKey(input.locale));
    }),

  listEditionPeriods: publicProcedure.query(({ ctx }) =>
    listEditionPeriods(ctx.db),
  ),

  getDirection: publicProcedure
    .input(
      z.object({
        slug: z.string().min(1).max(100),
        /**
         * 期次时间线的游标（排他：只取期号更小的期）。字段名必须是 `cursor` ——
         * @trpc/tanstack-react-query 把 infiniteQueryOptions 藏在
         * `TDef['input'] extends OptionalCursorInput` 后面, 叫 `before` 的话这个
         * 装饰在 proxy 上压根不存在, 前端只能退回手写 queryKey(于是 pathKey()
         * 再也覆盖不到它)。store 层的参数仍叫 before, 那个名字更说明它是排他的。
         *
         * nullish 而不是 optional: tRPC 的 initialPageParam 默认是 null, optional
         * 过不了校验。
         */
        cursor: z.number().int().min(1).nullish(),
        locale: localeInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      const localeKey = normalizeLocaleKey(input.locale);
      const detail = await getDirectionDetailBySlug(
        ctx.db,
        input.slug,
        input.cursor ?? undefined,
      );
      if (!detail) return null;
      return {
        slug: detail.slug,
        name: pickTldr(detail.name, localeKey) ?? detail.slug,
        intro: pickTldr(detail.intro, localeKey) ?? "",
        issueCount: detail.issueCount,
        paperCount: detail.paperCount,
        hasMore: detail.hasMore,
        issues: detail.issues.map((i) => ({
          issueNumber: i.issueNumber,
          title: pickTldr(i.title, localeKey) ?? "",
          // 正文只出摘要：四语 markdown 不下发（与合刊同一口径）
          excerpt: excerptFromMarkdown(pickTldr(i.content, localeKey)),
          publishedAt: i.publishedAt,
          periodStart: i.periodStart,
          periodEnd: i.periodEnd,
          pickCount: i.pickCount,
        })),
      };
    }),

  getIssue: publicProcedure
    .input(
      z.object({
        slug: z.string().min(1).max(100),
        issueNumber: z.number().int().min(1),
        locale: localeInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      const localeKey = normalizeLocaleKey(input.locale);
      const issue = await getPublishedIssueDetail(
        ctx.db,
        input.slug,
        input.issueNumber,
      );
      if (!issue) return null;
      // 期页 SSR loader 直读 D1 后走同一个映射, 保证两条路径下发的形状一致
      return mapIssueToLocale(issue, localeKey);
    }),
});
