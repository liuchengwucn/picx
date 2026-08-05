import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, lt, or, type SQL, sql } from "drizzle-orm";
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
  | "earliestPublishedAt"
  | "lastActivityAt"
  | "status"
  | "leadImage"
> & {
  // 聚合分数范围：story 内 item relevance_score 的 min/max，始终下发
  scoreMin: number | null;
  scoreMax: number | null;
};

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
    earliestPublishedAt: story.earliestPublishedAt,
    lastActivityAt: story.lastActivityAt,
    status: story.status,
    leadImage: story.leadImage,
    scoreMin: story.scoreMin,
    scoreMax: story.scoreMax,
  };
}

export const newsRouter = createTRPCRouter({
  list: publicProcedure
    .input(
      z.object({
        // 复合游标：同秒条目在批次边界不丢行（0025 迁移已消灭排序键 NULL）
        cursor: z
          .object({ ts: z.number().int(), shortId: z.string() })
          .nullish(),
        limit: z.number().int().min(1).max(50).default(20),
        sort: z.enum(["latest", "active"]).default("latest"),
        locale: z.enum(["en", "zh-CN", "zh-TW", "ja"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const localeKey = normalizeLocaleKey(input.locale ?? "en");
      // 字面量谓词：feed 的 partial index（WHERE status != 'hidden'）只匹配字面量，ne()/eq() 会失去索引
      // dirty=0：占位 story（未生成四语摘要）不进公开列表与 SEO，避免英文占位与半成品外泄
      const visible = sql`${newsStories.status} != 'hidden' AND ${newsStories.dirty} = 0`;
      // keyset 谓词下 NULL 排序键不可达（lt/eq 对 NULL 恒假）；0025 已回填存量 NULL、
      // 写入路径始终赋值，若出现 NULL 行该页游标直接终止。
      // latest 命中 feedPublishedIdx / active 命中 feedActiveIdx
      const sortCol =
        input.sort === "latest"
          ? newsStories.earliestPublishedAt
          : newsStories.lastActivityAt;
      let where: SQL | undefined = visible;
      if (input.cursor) {
        const cursorDate = new Date(input.cursor.ts);
        where = and(
          visible,
          or(
            lt(sortCol, cursorDate),
            and(
              eq(sortCol, cursorDate),
              lt(newsStories.shortId, input.cursor.shortId),
            ),
          ),
        );
      }

      // 显式投影：不要 select() 全列，避免把 4KB centroid blob 一并带出
      // limit+1 探测：多取一行判断是否还有下一页，避免恰好整除时产生幽灵
      // "加载更多" + 空页请求
      const rows = await ctx.db
        .select({
          shortId: newsStories.shortId,
          title: newsStories.title,
          summary: newsStories.summary,
          tags: newsStories.tags,
          itemCount: newsStories.itemCount,
          sourceCount: newsStories.sourceCount,
          signalsSummary: newsStories.signalsSummary,
          firstSeenAt: newsStories.firstSeenAt,
          earliestPublishedAt: newsStories.earliestPublishedAt,
          lastActivityAt: newsStories.lastActivityAt,
          status: newsStories.status,
          leadImage: newsStories.leadImage,
          // 聚合分数范围：per-story item relevance 相关子查询，命中
          // news_items_story_idx，limit<=50 时开销可忽略。分数始终下发——
          // 用户确认非隐私；是否展示由前端 debug 开关决定。
          // 陷阱：单表查询（无 join）时 drizzle 的 sqlite dialect 会把插值进 sql
          // 模板的 Column 剥去表限定符（isSingleTable 优化），
          // ${newsStories.id} 会被渲染成裸的 "id" ——在子查询里裸 "id" 解析成
          // news_items.id，导致 story_id = id 恒真/恒假而不是预期的关联，
          // min/max 永远是 NULL。因此这里手写别名 + 完整外层表名，绝不插值 Column。
          scoreMin: sql<
            number | null
          >`(SELECT min(ni.relevance_score) FROM news_items ni WHERE ni.story_id = news_stories.id)`,
          scoreMax: sql<
            number | null
          >`(SELECT max(ni.relevance_score) FROM news_items ni WHERE ni.story_id = news_stories.id)`,
        })
        .from(newsStories)
        .where(where)
        .orderBy(desc(sortCol), desc(newsStories.shortId))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const stories = hasMore ? rows.slice(0, input.limit) : rows;

      const last = stories.at(-1);
      const lastTs =
        input.sort === "latest"
          ? last?.earliestPublishedAt
          : last?.lastActivityAt;
      const nextCursor =
        hasMore && last && lastTs
          ? { ts: lastTs.getTime(), shortId: last.shortId }
          : null;

      return {
        stories: stories.map((s) => localizeStory(s, localeKey)),
        nextCursor,
      };
    }),

  byShortId: publicProcedure
    .input(
      z.object({
        shortId: z.string().min(1).max(10),
      }),
    )
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
          earliestPublishedAt: newsStories.earliestPublishedAt,
          lastActivityAt: newsStories.lastActivityAt,
          keyFacts: newsStories.keyFacts,
          related: newsStories.related,
        })
        .from(newsStories)
        .where(
          and(
            eq(newsStories.shortId, input.shortId),
            // 有意不过滤 dirty：直达链接展示未生成四语摘要的 story 也没问题，
            // 占位内容（英文标题/摘要）是真实内容，只是还没被四语覆盖。
            sql`${newsStories.status} != 'hidden'`,
          ),
        )
        .limit(1);
      if (!story)
        throw new TRPCError({ code: "NOT_FOUND", message: "Story not found" });

      // items 与相关资讯查询都只依赖 story（不互相依赖），并发发起省一个串行 D1 往返
      const relatedIds = story.related ?? [];
      const [items, relatedRows] = await Promise.all([
        ctx.db
          .select({
            url: newsItems.url,
            title: newsItems.title,
            excerpt: newsItems.excerpt,
            author: newsItems.author,
            publishedAt: newsItems.publishedAt,
            signals: newsItems.signals,
            media: newsItems.media,
            extra: newsItems.extra,
            // 分数始终下发，是否显示由前端 debug 开关决定
            relevanceScore: newsItems.relevanceScore,
            sourceName: newsSources.name,
            sourceType: newsSources.type,
          })
          .from(newsItems)
          .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
          .where(eq(newsItems.storyId, story.id))
          .orderBy(newsItems.publishedAt),
        // 相关资讯：预计算 shortId 数组 → 小 IN 查询取标题；读取侧过滤 hidden/占位，
        // 并按预计算的相似度顺序重排（IN 查询不保序）
        relatedIds.length > 0
          ? ctx.db
              .select({
                shortId: newsStories.shortId,
                title: newsStories.title,
                firstSeenAt: newsStories.firstSeenAt,
                earliestPublishedAt: newsStories.earliestPublishedAt,
              })
              .from(newsStories)
              .where(
                and(
                  inArray(newsStories.shortId, relatedIds),
                  sql`${newsStories.status} != 'hidden' AND ${newsStories.dirty} = 0`,
                ),
              )
          : Promise.resolve([]),
      ]);
      const related = relatedIds.flatMap((sid) => {
        const row = relatedRows.find((r) => r.shortId === sid);
        return row ? [row] : [];
      });

      // 详情页返回完整四语 JSON（head/组件各自按 locale 取），items 按时间正序做时间线
      return {
        shortId: story.shortId,
        title: story.title,
        summary: story.summary,
        tags: story.tags ?? [],
        signalsSummary: story.signalsSummary,
        firstSeenAt: story.firstSeenAt,
        earliestPublishedAt: story.earliestPublishedAt,
        lastActivityAt: story.lastActivityAt,
        keyFacts: story.keyFacts,
        related,
        items,
      };
    }),
});
