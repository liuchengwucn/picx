import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "#/db/schema";
import { newsStories } from "#/db/schema";

type Db = DrizzleD1Database<typeof schema>;

/**
 * 资讯详情页路径 → shortId。字符集是 generateShortId 的 base62, 长度放宽到
 * 4–16 位(生成器现在发 6 位), 免得哪天改长度这里静默失配。
 *
 * 收紧字符集的用处不在防注入(反正要参数化查库), 而在于把 `$` / `:` 这类模板
 * 字符挡在外面: Googlebot 会从 JS 包里挖出路由定义 `/news/$shortId` 去试抓,
 * 那种请求本来就该原样 404, 不值得再多查一次库。
 */
const NEWS_STORY_PATH = /^\/news\/([0-9A-Za-z]{4,16})$/;

export function matchNewsStoryPath(pathname: string): string | null {
  return NEWS_STORY_PATH.exec(pathname)?.[1] ?? null;
}

/**
 * 这条 shortId 是不是「曾经上线、后来被下架」的 story。
 *
 * 走 short_id 唯一索引, 与 news_stories 上那几个 `status != 'hidden'` 的
 * partial index 无关 —— 所以这里用 eq() 绑定参数是对的, 不必学别处写字面量谓词。
 */
export async function isHiddenStory(db: Db, shortId: string): Promise<boolean> {
  const [row] = await db
    .select({ shortId: newsStories.shortId })
    .from(newsStories)
    .where(
      and(eq(newsStories.shortId, shortId), eq(newsStories.status, "hidden")),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * 把「被下架的资讯」那一类 404 升级成 410 Gone, 其余原样放行。
 *
 * 只在渲染结果**已经**是 404 时调用, 所以正常详情页一次库都不会多查。资讯详情
 * 页的 404 有两种成因, 对搜索引擎的含义完全不同:
 *  - 库里根本没有这个 shortId(爬虫瞎试 / 手打错) —— 404, 说不定以后会有
 *  - story 被 status='hidden' 下架 —— 它曾经上线、进过 sitemap、被 Google 收录
 *    过, 是永久下架。410 能让搜索引擎比 404 快得多地把它从索引里删掉。
 *
 * 噪音回填一次就下架上百条(见 scripts/backfill-hide-noise.mjs), 这些地址在
 * Search Console 里会持续以「未找到」的形式积压, 这个函数就是给它们一个收场。
 *
 * body 复用原响应(那是 StoryNotFound 渲染出来的页面): 读者看到的东西不变,
 * 变的只有状态码。查库失败一律 fail-safe 回 null —— D1 抖一下不该把一个能正常
 * 渲染的 404 页面变成 500。
 */
export async function goneIfHiddenStory(
  pathname: string,
  response: Response,
  db: Db,
): Promise<Response | null> {
  const shortId = matchNewsStoryPath(pathname);
  if (!shortId) return null;
  try {
    if (!(await isHiddenStory(db, shortId))) return null;
  } catch {
    return null;
  }
  return new Response(response.body, {
    status: 410,
    statusText: "Gone",
    headers: response.headers,
  });
}
