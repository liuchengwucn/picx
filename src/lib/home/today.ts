import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "#/db/schema";
import {
  type NewsMedia,
  newsStories,
  paperResults,
  papers,
  whiteboardImages,
} from "#/db/schema";
import { compareFeatured, type GroupableStory } from "#/lib/news/group-stories";

// 首页「今日精选」数据。SSR loader 与 tRPC home.today 共用本查询,
// 两侧形状必须一致(loader 数据作为路由数据直出, 全部字段可序列化)。

// 与 lib/chat.ts、lib/agent.ts 同款：接收已建好的 drizzle 实例而非裸 D1Database,
// router 侧直传 ctx.db, SSR loader 侧自行 drizzle(env.DB)。
type Db = DrizzleD1Database<typeof schema>;

// 今日精选取材窗口: 24h 内全量候选按分数选头条+次级;
// 窗口内凑不满 HOME_STORY_COUNT 条(低频期)时放宽到最近 12 条(按时间)。
const HEADLINE_WINDOW_MS = 24 * 60 * 60 * 1000;
const HOME_STORY_COUNT = 6; // 1 头条 + 5 次级

// 与 news.list 同款相关子查询取 story 内 item 分数上限。
// 陷阱: 单表查询时 drizzle 会剥去插值 Column 的表限定符, 子查询里的
// ${newsStories.id} 会变成裸 id 被解析成 news_items.id, 结果恒 NULL,
// 因此手写别名+完整表名, 绝不插值 Column(见 news.ts list 的详细注释)。
const scoreMaxSql = sql<
  number | null
>`(SELECT max(ni.relevance_score) FROM news_items ni WHERE ni.story_id = news_stories.id)`;

const storyProjection = {
  shortId: newsStories.shortId,
  title: newsStories.title,
  leadImage: newsStories.leadImage,
  earliestPublishedAt: newsStories.earliestPublishedAt,
  firstSeenAt: newsStories.firstSeenAt,
  sourceCount: newsStories.sourceCount,
  signalsSummary: newsStories.signalsSummary,
  scoreMax: scoreMaxSql,
};

export interface HomeStory {
  shortId: string;
  title: Record<string, string>;
  // 刻意不带 summary: 首页只渲染标题, 而四语 summary JSON 会随 loader 数据一起
  // 内联进首屏 HTML(实测约占 8%)。要加回来之前先确认真的有组件渲染它。
  leadImage: NewsMedia | null;
  /**
   * earliestPublishedAt ?? firstSeenAt, epoch ms。
   * 排序只看 earliestPublishedAt(0025 迁移已消灭存量 NULL, 写入路径始终赋值);
   * firstSeenAt 兜底仅为类型安全, 不影响实际排序结果。
   */
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
  /** 24h 窗口内按分数选出的头条+次级(≤6), 分数从高到低 */
  stories: HomeStory[];
  /** 最近入库 4 篇公开画廊论文 */
  papers: HomePaper[];
}

// 主查询: 24h 窗口在 SQL 过滤, 按分数取 top-N(SQLite 的 DESC 排序把 NULL
// scoreMax 排在最后)。limit 36 只是安全上限, 正常一天的 story 远少于此。
// 状态谓词保持字面量(partial index 只认字面量), 窗口条件是普通绑定参数。
async function loadStoryCandidates(db: Db, windowStart: Date) {
  const rows = await db
    .select(storyProjection)
    .from(newsStories)
    .where(
      and(
        sql`${newsStories.status} != 'hidden' AND ${newsStories.dirty} = 0`,
        gte(newsStories.earliestPublishedAt, windowStart),
      ),
    )
    .orderBy(
      desc(scoreMaxSql),
      desc(newsStories.sourceCount),
      desc(newsStories.earliestPublishedAt),
    )
    .limit(36);
  if (rows.length >= HOME_STORY_COUNT) return rows;
  // 低频兜底: 窗口内凑不满 6 条时放宽到最近 12 条, 选择仍按分数
  return db
    .select(storyProjection)
    .from(newsStories)
    .where(sql`${newsStories.status} != 'hidden' AND ${newsStories.dirty} = 0`)
    .orderBy(desc(newsStories.earliestPublishedAt), desc(newsStories.shortId))
    .limit(12);
}

// 与 news 页大头条同款优先级(compareFeatured: scoreMax → sourceCount → HN
// points)。返回按分数从高到低的前 count 条; 并列时保持输入顺序(sort 稳定,
// 输入来自 SQL 的 score/时间倒序), 即并列取更新的。
export function pickTopStories<T extends GroupableStory>(
  candidates: T[],
  count: number,
): T[] {
  return [...candidates].sort((a, b) => compareFeatured(b, a)).slice(0, count);
}

export async function getHomeToday(db: Db): Promise<HomeToday> {
  const now = Date.now();
  const windowStart = new Date(now - HEADLINE_WINDOW_MS);
  const [storyRows, paperRows] = await Promise.all([
    loadStoryCandidates(db, windowStart),
    db
      .select({
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
      // paper_results.paper_id / whiteboard_images 的默认图都不是唯一约束(历史脏
      // 数据或重复处理可能有多行), 按 papers.id 聚合去重, 与 paper.listPublic 同款。
      // SQL 级去重必须在 limit 之前做, 否则 join 放大行数会让 limit 先吃掉重复行,
      // 静默把返回条数缩水到 < 4。
      .groupBy(papers.id)
      .orderBy(desc(papers.publishedAt))
      .limit(4),
  ]);

  return {
    now,
    stories: pickTopStories(storyRows, HOME_STORY_COUNT).map((s) => ({
      shortId: s.shortId,
      title: s.title,
      leadImage: s.leadImage ?? null,
      publishedAt: (s.earliestPublishedAt ?? s.firstSeenAt).getTime(),
    })),
    papers: paperRows.map((p) => ({
      shortId: p.shortId,
      title: p.title,
      tldr: p.tldr ?? null,
      hasImage: p.whiteboardKey != null,
    })),
  };
}

export interface TodayCards {
  headline: HomeStory | null;
  /** 头条卡内的次级标题, ≤5 */
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
    subStories: restStories.slice(0, 5),
    latestPaper: latestPaper ?? null,
    galleryPicks: restPapers.slice(0, 3),
  };
}
