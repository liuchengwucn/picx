import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  type NewsMedia,
  newsStories,
  paperResults,
  papers,
  whiteboardImages,
} from "#/db/schema";

// 首页「今日精选」数据。SSR loader 与 tRPC home.today 共用本查询,
// 两侧形状必须一致(loader 数据作为路由数据直出, 全部字段可序列化)。

export interface HomeStory {
  shortId: string;
  title: Record<string, string>;
  summary: Record<string, string>;
  leadImage: NewsMedia | null;
  /** earliestPublishedAt ?? firstSeenAt, epoch ms */
  publishedAt: number;
}

export interface HomePaper {
  shortId: string;
  title: string;
  tldr: Record<string, string> | null;
  hasImage: boolean;
}

export interface HomeToday {
  /** 查询侧捕获一次; 客户端相对时间以它为基准, 避免 SSR/hydration 文本漂移 */
  now: number;
  /** 最新 3 条公开资讯 */
  stories: HomeStory[];
  /** 最近入库 4 篇公开画廊论文 */
  papers: HomePaper[];
}

export async function getHomeToday(d1: D1Database): Promise<HomeToday> {
  const db = drizzle(d1);
  const [storyRows, paperRows] = await Promise.all([
    db
      .select({
        shortId: newsStories.shortId,
        title: newsStories.title,
        summary: newsStories.summary,
        leadImage: newsStories.leadImage,
        earliestPublishedAt: newsStories.earliestPublishedAt,
        firstSeenAt: newsStories.firstSeenAt,
      })
      .from(newsStories)
      // 字面量谓词与 news.list 一致: partial index 只认字面量;
      // dirty=0 挡未生成四语摘要的占位 story
      .where(
        sql`${newsStories.status} != 'hidden' AND ${newsStories.dirty} = 0`,
      )
      .orderBy(desc(newsStories.earliestPublishedAt))
      .limit(3),
    db
      .select({
        id: papers.id,
        shortId: papers.shortId,
        title: papers.title,
        tldr: paperResults.tldr,
        whiteboardKey: whiteboardImages.imageR2Key,
      })
      .from(papers)
      .leftJoin(paperResults, eq(paperResults.paperId, papers.id))
      .leftJoin(
        whiteboardImages,
        and(
          eq(whiteboardImages.paperId, papers.id),
          eq(whiteboardImages.isDefault, true),
        ),
      )
      .where(
        and(
          eq(papers.isPublic, true),
          eq(papers.isListedInGallery, true),
          eq(papers.status, "completed"),
          isNull(papers.deletedAt),
        ),
      )
      .orderBy(desc(papers.publishedAt))
      .limit(6),
  ]);

  // 防御性去重(与 sitemap 同理): 默认白板应唯一, 但约束破坏时 join 会重复行
  const seen = new Set<string>();
  const dedupedPapers = paperRows
    .filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    })
    .slice(0, 4);

  return {
    now: Date.now(),
    stories: storyRows.map((s) => ({
      shortId: s.shortId,
      title: s.title,
      summary: s.summary,
      leadImage: s.leadImage ?? null,
      publishedAt: (s.earliestPublishedAt ?? s.firstSeenAt).getTime(),
    })),
    papers: dedupedPapers.map((p) => ({
      shortId: p.shortId,
      title: p.title,
      tldr: p.tldr ?? null,
      hasImage: p.whiteboardKey != null,
    })),
  };
}

export interface TodayCards {
  headline: HomeStory | null;
  /** 头条卡内的次级标题, ≤2 */
  subStories: HomeStory[];
  /** 论文卡(最新一篇) */
  latestPaper: HomePaper | null;
  /** 简报位 fallback「画廊精选」卡, ≤3, 与 latestPaper 不重复 */
  galleryPicks: HomePaper[];
}

/** 纯函数: 把查询结果切分到四张卡, 空态用 null/[] 表达(渲染侧据此隐藏/降级)。 */
export function assembleTodayCards(
  data: Pick<HomeToday, "stories" | "papers">,
): TodayCards {
  const [headline, ...restStories] = data.stories;
  const [latestPaper, ...restPapers] = data.papers;
  return {
    headline: headline ?? null,
    subStories: restStories.slice(0, 2),
    latestPaper: latestPaper ?? null,
    galleryPicks: restPapers.slice(0, 3),
  };
}
