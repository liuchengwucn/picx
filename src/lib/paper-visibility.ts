import { and, eq, isNull, type SQL } from "drizzle-orm";
import { papers, whiteboardImages } from "#/db/schema";

/**
 * 「一篇论文对外可见吗」这件事的**权威**定义 —— 但还不是唯一的一份。
 *
 * 仍然逐字手抄这四条的地方(有意留在本次重构范围之外, 收口是后续任务):
 * `lib/related-papers.ts`、`workers/tweet-poster-cron.ts` 两处 —— 它们与本函数等价,
 * 改本函数必须同时改这三处, 否则就是下面那次漂移的重演。
 * `trpc/routers/paper.ts:1451`(投票鉴权)少一条 status, 属于同一类待收口的子集。
 *
 * 与它们不同, 按 shortId 取单篇的详情路径(`paper.ts:906`、`lib/paper-markdown.ts`、
 * `lib/whiteboard-render.ts`、`routes/p/$shortId.tsx`)只查 isPublic + deletedAt,
 * 这**不是**漂移: 「从画廊流里下架」(isListedInGallery=false)不该让那篇论文的页面
 * 404, 它们要的本来就是另一条更宽的谓词。别顺手把它们也换成本函数。
 *
 * 抽出来的原因不是去重那四行, 而是这四行曾经六处手抄、并且真的漂过一次:
 * 方向页的 paperCount 少了白板那一层, 于是屏幕上出现「18 篇入选论文」配 2 张卡。
 * 当时 store.ts 里已经有一条注释在抱怨同一件事 —— 注释这条路试过并且输了,
 * 所以这次给的是一份可 import 的定义 + 一条把两个口径钉在一起的测试
 * (paper-feedback.test.ts 的「paperCount 等于 listPublic 的 total」)。
 *
 * ## 两种形状, 别混
 *
 * - `publicPaperConditions()` = 对外可见。sitemap / llms / llms-full / 首页今日
 *   用这一份: 它们收录的是「这篇论文的页面能不能被访问」, 与有没有配图无关。
 * - `galleryListableConditions()` = 上面那份 **再加上「必须有默认白板」**。画廊流的
 *   卡片以白板图为主体, 无图的卡不成立, 所以它比「可见」更窄。
 *
 * ## 白板那一层必须成对使用(这就是上次漏掉的东西)
 *
 * drizzle 的 join 只能挂在 query builder 上, 拿不出来放进条件数组, 所以
 * `galleryListableConditions()` **只是一半**, 另一半是调用方自己写的
 * `.innerJoin(whiteboardImages, defaultWhiteboardOn())`。两者缺一不可:
 * 只 spread 条件而忘了 innerJoin, 得到的正是上次那个 bug —— 而且因为「我用了
 * helper」会让人觉得安全, 比手抄更危险。所以两个导出在文档里互相点名, 改一个必须
 * 看另一个; 真正的保险是那条把两个口径绑在一起的测试。
 *
 * leftJoin 的调用方(sitemap / 首页今日)要的是「有没有图」这个信息本身而不是
 * 「必须有图」, 它们**刻意**只用 `publicPaperConditions()` + `defaultWhiteboardOn()`
 * 的 leftJoin, 不要往它们身上加白板条件。
 *
 * 返回新数组而不是导出常量: `paper.listPublic` 会往这份条件上 `push` 搜索 / 分类 /
 * 方向筛选, 共享一个模块级数组会让上一次请求的筛选条件泄漏到下一次。
 */
export function publicPaperConditions(): SQL[] {
  return [
    eq(papers.isPublic, true),
    eq(papers.isListedInGallery, true),
    eq(papers.status, "completed"),
    isNull(papers.deletedAt),
  ];
}

/**
 * 画廊流(/gallery/archive、方向页论文流)能列出来的论文。
 *
 * **必须与 `.innerJoin(whiteboardImages, defaultWhiteboardOn())` 一起用** ——
 * 「有默认白板」这一条在这个数组里表达不了, 见本文件顶部。
 *
 * 今天它逐条等于 `publicPaperConditions()`, 两个口径的全部差别就在那个 innerJoin 上。
 * 仍然给它一个名字, 是为了让调用点自己声明处在哪一种口径(而不是让读者去数下面有没有
 * 那个 join), 也给「将来画廊流多一条只属于它的谓词」留一个唯一的落点。别把它折叠掉。
 */
export function galleryListableConditions(): SQL[] {
  return publicPaperConditions();
}

/**
 * 默认白板图 join 的 ON 条件。inner 还是 left 由调用方决定, 语义差别很大:
 * innerJoin = 「无图的不要」(画廊流), leftJoin = 「顺手把有没有图带出来」(sitemap /
 * 首页今日)。
 *
 * 默认白板不是唯一约束(历史脏数据可能一篇多张), 所以两种 join 都要配
 * `groupBy(papers.id)` 或应用层去重, 否则一篇论文会占多行。
 */
export function defaultWhiteboardOn() {
  return and(
    eq(whiteboardImages.paperId, papers.id),
    eq(whiteboardImages.isDefault, true),
  );
}
