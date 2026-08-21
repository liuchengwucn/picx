import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "#/db/schema";
import {
  type NewsMedia,
  newsStories,
  paperResults,
  papers,
  whiteboardImages,
} from "#/db/schema";
import { getEditionByPeriod } from "#/lib/digest/edition-store";
import { compareFeatured, type GroupableStory } from "#/lib/news/group-stories";
import {
  defaultWhiteboardOn,
  publicPaperConditions,
} from "#/lib/paper-visibility";

// 首页「今日精选」数据。SSR loader 与 tRPC home.today 共用本查询,
// 两侧形状必须一致(loader 数据作为路由数据直出, 全部字段可序列化)。

// 与 lib/chat.ts、lib/agent.ts 同款：接收已建好的 drizzle 实例而非裸 D1Database,
// router 侧直传 ctx.db, SSR loader 侧自行 drizzle(env.DB)。
//
// $client 这一段是给 edition-store 用的: 那边(以及 digest/store.ts、admin-store.ts)
// 的 Db 写作 ReturnType<typeof drizzle>, 里面带 $client, 光有
// DrizzleD1Database<typeof schema> 传不进去。两个真实调用方(ctx.db 与 loader 里的
// drizzle(env.DB, { schema }))都是 drizzle() 的直接返回值, 本来就带这个字段。
type Db = DrizzleD1Database<typeof schema> & { $client: D1Database };

// 今日精选取材窗口: 24h 内全量候选按分数选头条+次级;
// 窗口内凑不满 HOME_STORY_COUNT 条(低频期)时放宽到最近 12 条(按时间)。
const HEADLINE_WINDOW_MS = 24 * 60 * 60 * 1000;
// 1 头条 + 8 次级。8 是资讯卡最高档(fit-level L3)的条数上限, 不是常态渲染量 ——
// SSR 只渲染 5 条(L0), 多出的 3 条只在客户端测出卡内真有空间时才升上去。
// 代价是 3 条四语标题约 1.6KB 进首屏 HTML, 这是「填满」的唯一手段(见
// 2026-08-21-home-fit-level-design.md 第 3 节: 密度加满也只到约 450px)。
const HOME_STORY_COUNT = 9;

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
   * story 聚合到的来源数。资讯卡次条在高档位下会渲染「N 个来源」副行,
   * 复用 m.news_sources_count(与 /news 列表页同一个键、同一个口径)。
   * 零新增查询成本: storyProjection 本来就在查它, 只是没往外露。
   */
  sourceCount: number;
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

/**
 * 首页周刊卡渲染所需的最小切片: 刊头级数字 + 前两个栏目的名字与标题 + 其余方向名。
 */
export interface HomeEdition {
  /**
   * 周期两端, epoch ms(与 HomeStory.publishedAt 同款数字而不是 Date: loader 数据
   * 要序列化进首屏 HTML, Date 在 SSR/tRPC 两条路径上的还原结果会分歧)。
   *
   * 两端都是 UTC 边界(00:00:00 / 23:59:59), 渲染侧必须按 UTC 格化。
   */
  periodStart: number;
  periodEnd: number;
  /** active 方向总数(含本期缺席的), 与刊头第一个数字同源 */
  activeDirectionCount: number;
  /** 本期有更新的方向数 */
  directionCount: number;
  /** 本期入选总篇数 */
  pickCount: number;
  /**
   * 前若干个栏目(顺序与合刊页栏目顺序同源, 上限 EDITION_HIGHLIGHT_MAX = 6)。
   * 方向名与期标题都保留四语 Record 原样, 由组件按当前 locale 挑 —— 服务端不知道
   * 客户端渲染时的 locale(语言切换不重新走 loader)。
   *
   * 这是**供给**不是渲染量: 首页周刊卡 SSR 只渲染前 2 条, 其余由 fit-level 升档
   * 时才用上。上一轮实测 2 条约 1.15 KB(几乎全部是四语标题, CJK 一字 3 字节),
   * 按约 550 字节/条线性外推 6 条约 3.3 KB; 加上 otherDirectionNames 的约 0.5 KB,
   * 整个 edition 字段约 3.8 KB。整份 sections 是几十 KB 量级 —— 那才是这个字段
   * 存在的理由。
   */
  highlights: Array<{
    directionName: Record<string, string>;
    title: Record<string, string> | null;
  }>;
  /**
   * 本期有更新、但没排进 highlights 的方向名(即 sections.slice(EDITION_HIGHLIGHT_MAX))。
   * 只有名字没有标题: 四语一条约 80–110 字节(实测 seed-directions.sql:13 的
   * 「AI 形式化数学」是 110; 更短的方向名按同构造式推算 80–95 —— 仓库目前只有
   * formal-math 一个方向, 没有第二条可实测, 别再去翻了)。7 个方向 = 这里 1 条,
   * 满打满算约 0.5KB —— 比 highlights 里每条带四语期标题的约 550 字节便宜五六倍,
   * 所以这个字段可以列全, 而 highlights 仍然只露两条。
   *
   * 刻意不含本期缺席的方向(activeDirectionCount − directionCount 那一部分): 卡上就写着
   * 「N 个方向 · M 篇入选」, 这一行若混进没更新的方向, 数字与清单会自相矛盾。
   */
  otherDirectionNames: Array<Record<string, string>>;
}

export interface HomeToday {
  /** 查询侧捕获一次; 客户端相对时间以它为基准, 避免 SSR/hydration 文本漂移 */
  now: number;
  /** 24h 窗口内按分数选出的头条+次级(≤9, 供给上限, 见 HOME_STORY_COUNT), 分数从高到低 */
  stories: HomeStory[];
  /** 最近入库 4 篇公开画廊论文 */
  papers: HomePaper[];
  /** 最新一期合刊的摘要; 还没有任何 published 期时为 null(首页回退到画廊精选卡) */
  edition: HomeEdition | null;
}

/**
 * 首页周刊卡**最多**露几条带标题的栏目。这是供给上限而不是渲染量:
 * SSR 只渲染 2 条(fit-level L0), 4 / 6 条是客户端测出卡内有空间后才升的档。
 *
 * 每多一条就多一份四语期标题进首屏 HTML(约 550 字节/条, 上一轮实测),
 * 2 → 6 的代价约 +2.2KB。其余方向仍只出名字(otherDirectionNames),
 * 那个量级是 80–110 字节/条, 便宜五六倍, 所以可以列全。
 */
const EDITION_HIGHLIGHT_MAX = 6;

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
  // 低频兜底: 窗口内凑不满 HOME_STORY_COUNT 条时放宽到最近 12 条, 选择仍按分数
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
  const [storyRows, paperRows, edition] = await Promise.all([
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
      // leftJoin 是刻意的: 首页要的是 hasImage 这个信息本身, 无图论文照常上榜
      // (画廊流那种 innerJoin 会让「今日」在图还没生成时空掉)。见 lib/paper-visibility.ts。
      .leftJoin(whiteboardImages, defaultWhiteboardOn())
      .where(and(...publicPaperConditions()))
      // paper_results.paper_id / whiteboard_images 的默认图都不是唯一约束(历史脏
      // 数据或重复处理可能有多行), 按 papers.id 聚合去重, 与 paper.listPublic 同款。
      // SQL 级去重必须在 limit 之前做, 否则 join 放大行数会让 limit 先吃掉重复行,
      // 静默把返回条数缩水到 < 4。
      // 4 这个数是刻意留有余量的: 有合刊时第 4 篇渲染侧用不上, 但别裁, 理由见
      // assembleTodayCards 里的注释。
      .groupBy(papers.id)
      .orderBy(desc(papers.publishedAt))
      .limit(4),
    // 最新一期合刊。复用 getEditionByPeriod 而不是在这里另写一个"取最新一组"的
    // 查询: 「同方向同 period_end 只认 issue_number 最大的那条」这条去重规则很细
    // (见 edition-store 的 isWinningDigest 注释), 手抄一份必然与合刊页漂开, 结果
    // 就是首页写「7 个方向」点进去数出 8 个。代价是它顺带把四语正文 markdown 也
    // 从 D1 读出来了(约几十 KB 行读), 但那些字段在下面就被丢掉、绝不进 HTML。
    getEditionByPeriod(db, null),
  ]);

  return {
    now,
    stories: pickTopStories(storyRows, HOME_STORY_COUNT).map((s) => ({
      shortId: s.shortId,
      title: s.title,
      leadImage: s.leadImage ?? null,
      sourceCount: s.sourceCount,
      publishedAt: (s.earliestPublishedAt ?? s.firstSeenAt).getTime(),
    })),
    papers: paperRows.map((p) => ({
      shortId: p.shortId,
      title: p.title,
      tldr: p.tldr ?? null,
      hasImage: p.whiteboardKey != null,
    })),
    // 逐字段挑而不是 { ...edition }: sections 里每个栏目带一份四语 markdown 正文,
    // 整份铺开是几十 KB, 而首页 loader 的返回值会原样内联进首屏 HTML(HomeStory
    // 刻意不带 summary 就是这个理由, 见上面的注释)。
    edition: edition && {
      periodStart: edition.periodStart.getTime(),
      periodEnd: edition.periodEnd.getTime(),
      activeDirectionCount: edition.activeDirectionCount,
      directionCount: edition.sections.length,
      pickCount: edition.sections.reduce((sum, s) => sum + s.pickCount, 0),
      highlights: edition.sections
        .slice(0, EDITION_HIGHLIGHT_MAX)
        .map((s) => ({ directionName: s.directionName, title: s.title })),
      otherDirectionNames: edition.sections
        .slice(EDITION_HIGHLIGHT_MAX)
        .map((s) => s.directionName),
    },
  };
}

export interface TodayCards {
  headline: HomeStory | null;
  /** 头条卡内的次级标题, ≤8(是供给上限; SSR 只渲染前 5 条, 见 use-fit-level) */
  subStories: HomeStory[];
  /**
   * 周刊卡的数据。与 galleryPicks 严格互斥 —— 这一个字段既是「渲染哪张卡」的判别式,
   * 也是那张卡的数据源。组件不要再自己测 today.edition: 那会让同一个判别式出现第二份
   * 拷贝, 两处一旦漂开就重新出现「同一篇论文渲染两次」, 而单测只看得见这个纯函数。
   */
  edition: HomeEdition | null;
  /** 论文卡(最新一篇) */
  latestPaper: HomePaper | null;
  /**
   * 论文卡底座上的次要论文, ≤2。与 galleryPicks 互斥(见 assembleTodayCards 的注释)。
   */
  relatedPapers: HomePaper[];
  /** 简报位 fallback「画廊精选」卡, ≤3, 与 latestPaper 不重复; 有合刊时恒为 [] */
  galleryPicks: HomePaper[];
}

/** 纯函数: 把查询结果切分到四张卡, 空态用 null/[] 表达(渲染侧据此隐藏/降级)。 */
export function assembleTodayCards(
  data: Pick<HomeToday, "stories" | "papers" | "edition">,
): TodayCards {
  const [headline, ...restStories] = data.stories;
  const [latestPaper, ...restPapers] = data.papers;
  // 周刊卡与「画廊精选」卡是互斥渲染的(见 today-strip 的 edition 分支), 次要论文的分配
  // 必须跟着同一个分支走: 有合刊时 papers[1..2] 归论文卡底座, 没有合刊时 papers[1..3]
  // 归画廊精选卡。无条件两边都取会让同一篇论文在首页出现两次。
  const hasEdition = data.edition != null;
  // 已知且刻意的浪费: 有合刊(首期发布后的常态路径)时只用到 papers[0..2], papers[3]
  // 照查、照序列化进首屏 HTML、渲染侧一个字都不用, 成本约 0.5KB。别去裁上游那个
  // limit(4) —— 那会让 getHomeToday 的返回形状取决于这里的卡片分配规则, 把查询函数
  // 和纯函数绑死, 不值这 0.5KB。写在这里是免得下一个人再算一遍。
  return {
    headline: headline ?? null,
    subStories: restStories.slice(0, 8),
    // ?? null 在这一行其实是冗余的(上游已经是 HomeEdition | null, 不像 headline /
    // latestPaper 那样从可能为空的数组解构出 undefined), 保留只为让三行同形 ——
    // 一行例外会诱使下一个人反过来把「这里不需要」的结论抄到真正需要它的字段上。
    edition: data.edition ?? null,
    latestPaper: latestPaper ?? null,
    relatedPapers: hasEdition ? restPapers.slice(0, 2) : [],
    galleryPicks: hasEdition ? [] : restPapers.slice(0, 3),
  };
}
