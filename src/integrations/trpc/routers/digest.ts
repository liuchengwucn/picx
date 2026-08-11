import { z } from "zod";
import { excerptFromMarkdown, mapIssueToLocale } from "#/lib/digest/present";
import {
  getDirectionDetailBySlug,
  getPublishedIssueDetail,
  listActiveDirections,
} from "#/lib/digest/store";
import { normalizeLocaleKey, pickTldr } from "#/lib/tldr";
import { publicProcedure, router } from "../init";

const localeInput = z.enum(["en", "zh-CN", "zh-TW", "ja"]).optional();

export const digestRouter = router({
  listDirections: publicProcedure
    .input(z.object({ locale: localeInput }))
    .query(async ({ ctx, input }) => {
      const localeKey = normalizeLocaleKey(input.locale);
      const dirs = await listActiveDirections(ctx.db);
      return dirs.map((d) => ({
        slug: d.slug,
        name: pickTldr(d.name, localeKey) ?? d.slug,
        latestIssue: d.latestIssue
          ? {
              issueNumber: d.latestIssue.issueNumber,
              title: pickTldr(d.latestIssue.title, localeKey) ?? "",
              publishedAt: d.latestIssue.publishedAt,
            }
          : null,
      }));
    }),

  getDirection: publicProcedure
    .input(z.object({ slug: z.string().min(1).max(100), locale: localeInput }))
    .query(async ({ ctx, input }) => {
      const localeKey = normalizeLocaleKey(input.locale);
      const detail = await getDirectionDetailBySlug(ctx.db, input.slug);
      if (!detail) return null;
      return {
        slug: detail.slug,
        name: pickTldr(detail.name, localeKey) ?? detail.slug,
        intro: pickTldr(detail.intro, localeKey) ?? "",
        latestExcerpt: excerptFromMarkdown(
          pickTldr(detail.latestContent, localeKey),
        ),
        issues: detail.issues.map((i) => ({
          issueNumber: i.issueNumber,
          title: pickTldr(i.title, localeKey) ?? "",
          publishedAt: i.publishedAt,
          periodStart: i.periodStart,
          periodEnd: i.periodEnd,
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
