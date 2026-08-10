import { z } from "zod";
import {
  getDirectionDetailBySlug,
  getPublishedIssueDetail,
  listActiveDirections,
} from "#/lib/digest/store";
import { normalizeLocaleKey, pickTldr } from "#/lib/tldr";
import { publicProcedure, router } from "../init";

const localeInput = z.enum(["en", "zh-CN", "zh-TW", "ja"]).optional();

/** 从简报 markdown 正文抽首段纯文本做摘要（跳过标题行/空行，截 160 字符） */
export function excerptFromMarkdown(md: string | null | undefined): string {
  if (!md) return "";
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    // 剥完标记（引用号/强调符）可能留下首尾空白，再 trim 一次
    const plain = t
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`>]/g, "")
      .trim();
    if (plain) return plain.length > 160 ? `${plain.slice(0, 160)}…` : plain;
  }
  return "";
}

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
        focusBrief: detail.focusBrief,
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
      return {
        directionSlug: issue.directionSlug,
        directionName:
          pickTldr(issue.directionName, localeKey) ?? issue.directionSlug,
        issueNumber: issue.issueNumber,
        title: pickTldr(issue.title, localeKey) ?? "",
        content: pickTldr(issue.content, localeKey) ?? "",
        periodStart: issue.periodStart,
        periodEnd: issue.periodEnd,
        publishedAt: issue.publishedAt,
        papers: issue.papers.map((p) => ({
          id: p.id,
          shortId: p.shortId,
          title: p.title,
          tldr: pickTldr(p.tldr, localeKey) ?? "",
          whiteboardImageR2Key: p.whiteboardImageR2Key,
          recommendationNote: pickTldr(p.recommendationNote, localeKey) ?? "",
          rank: p.rank,
          likeCount: p.likeCount,
        })),
        prevIssue: issue.prevIssue,
        nextIssue: issue.nextIssue,
      };
    }),
});
