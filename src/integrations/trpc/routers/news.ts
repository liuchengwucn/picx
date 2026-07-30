import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { newsItems, newsSources, newsStories } from "#/db/schema";
import { normalizeLocaleKey, pickTldr } from "#/lib/tldr";
import { createTRPCRouter, publicProcedure } from "../init";

type StoryCardRow = Pick<
  typeof newsStories.$inferSelect,
  | "shortId"
  | "title"
  | "summary"
  | "tags"
  | "itemCount"
  | "sourceCount"
  | "signalsSummary"
  | "firstSeenAt"
  | "lastActivityAt"
  | "status"
>;

// story 列表卡片所需字段；标题/摘要按请求 locale 服务端取好，减少载荷
function localizeStory(
  story: StoryCardRow,
  localeKey: "en" | "zh-cn" | "zh-tw" | "ja",
) {
  return {
    shortId: story.shortId,
    title: pickTldr(story.title, localeKey) ?? "",
    summary: pickTldr(story.summary, localeKey) ?? "",
    tags: story.tags ?? [],
    itemCount: story.itemCount,
    sourceCount: story.sourceCount,
    signalsSummary: story.signalsSummary,
    firstSeenAt: story.firstSeenAt,
    lastActivityAt: story.lastActivityAt,
    status: story.status,
  };
}

export const newsRouter = createTRPCRouter({
  list: publicProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(50).default(20),
        sort: z.enum(["latest", "active"]).default("latest"),
        locale: z.enum(["en", "zh-CN", "zh-TW", "ja"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const localeKey = normalizeLocaleKey(input.locale ?? "en");
      const offset = (input.page - 1) * input.limit;
      // 字面量谓词：feed 的 partial index（WHERE status != 'hidden'）只匹配字面量，ne()/eq() 会失去索引
      // dirty=0：占位 story（未生成四语摘要）不进公开列表与 SEO，避免英文占位与半成品外泄
      const visible = sql`${newsStories.status} != 'hidden' AND ${newsStories.dirty} = 0`;
      const orderBy =
        input.sort === "latest"
          ? desc(newsStories.firstSeenAt)
          : desc(newsStories.lastActivityAt);

      // 显式投影：不要 select() 全列，避免把 4KB centroid blob 一并带出
      const stories = await ctx.db
        .select({
          shortId: newsStories.shortId,
          title: newsStories.title,
          summary: newsStories.summary,
          tags: newsStories.tags,
          itemCount: newsStories.itemCount,
          sourceCount: newsStories.sourceCount,
          signalsSummary: newsStories.signalsSummary,
          firstSeenAt: newsStories.firstSeenAt,
          lastActivityAt: newsStories.lastActivityAt,
          status: newsStories.status,
        })
        .from(newsStories)
        .where(visible)
        .orderBy(orderBy)
        .limit(input.limit)
        .offset(offset);
      const [total] = await ctx.db
        .select({ count: count() })
        .from(newsStories)
        .where(visible);

      return {
        stories: stories.map((s) => localizeStory(s, localeKey)),
        total: total.count,
      };
    }),

  byShortId: publicProcedure
    .input(z.string().min(1).max(10))
    .query(async ({ ctx, input }) => {
      const [story] = await ctx.db
        .select({
          id: newsStories.id,
          shortId: newsStories.shortId,
          title: newsStories.title,
          summary: newsStories.summary,
          tags: newsStories.tags,
          signalsSummary: newsStories.signalsSummary,
          firstSeenAt: newsStories.firstSeenAt,
          lastActivityAt: newsStories.lastActivityAt,
        })
        .from(newsStories)
        .where(
          and(
            eq(newsStories.shortId, input),
            // 有意不过滤 dirty：直达链接展示未生成四语摘要的 story 也没问题，
            // 占位内容（英文标题/摘要）是真实内容，只是还没被四语覆盖。
            sql`${newsStories.status} != 'hidden'`,
          ),
        )
        .limit(1);
      if (!story)
        throw new TRPCError({ code: "NOT_FOUND", message: "Story not found" });

      const items = await ctx.db
        .select({
          url: newsItems.url,
          title: newsItems.title,
          excerpt: newsItems.excerpt,
          author: newsItems.author,
          publishedAt: newsItems.publishedAt,
          signals: newsItems.signals,
          media: newsItems.media,
          extra: newsItems.extra,
          sourceName: newsSources.name,
          sourceType: newsSources.type,
        })
        .from(newsItems)
        .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
        .where(eq(newsItems.storyId, story.id))
        .orderBy(newsItems.publishedAt);

      // 详情页返回完整四语 JSON（head/组件各自按 locale 取），items 按时间正序做时间线
      return {
        shortId: story.shortId,
        title: story.title,
        summary: story.summary,
        tags: story.tags ?? [],
        signalsSummary: story.signalsSummary,
        firstSeenAt: story.firstSeenAt,
        lastActivityAt: story.lastActivityAt,
        items,
      };
    }),
});
