// src/lib/digest/edition-store.ts
//
// 「画廊周刊」落地页的只读聚合查询：把 7 个方向同一周的 published digests
// 拼成一期合刊。与 store.ts 里 ensureDigestShell 等 workflow 写路径没有依赖
// 关系，独立成模块——store.ts 已经因为写路径的历史积累到 885 行，没必要把
// 纯读聚合也塞进去。
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import {
  digestPapers,
  digests,
  directions,
  papers,
  whiteboardImages,
} from "#/db/schema";

type Db = ReturnType<typeof drizzle>;

/** 合刊栏目里每栏露几篇 picks。改这个数只需改这一处。 */
export const PICKS_PER_SECTION = 3;

export interface EditionPick {
  id: string;
  shortId: string | null;
  title: string;
  recommendationNote: Record<string, string> | null;
  /** 兜底发布的期会有未完成白板管线的论文 —— leftJoin，可为 null */
  whiteboardImageR2Key: string | null;
  rank: number;
}

export interface EditionSection {
  directionSlug: string;
  directionName: Record<string, string>;
  /** 方向识别色的先到先得排序键（见后续任务的 lib/digest/direction-color.ts） */
  directionCreatedAt: Date;
  issueNumber: number;
  title: Record<string, string> | null;
  /** 四语 markdown 全文，仅供后续 mapEditionToLocale 抽摘要；绝不下发到客户端 */
  content: Record<string, string> | null;
  /** 本期该方向入选总篇数（不是 picks.length） */
  pickCount: number;
  /** 前 PICKS_PER_SECTION 篇，按 rank 升序 */
  picks: EditionPick[];
}

export interface EditionDetail {
  /** UTC 日期字符串 YYYY-MM-DD，= 本期的稳定标识与 URL 参数 */
  period: string;
  periodStart: Date;
  periodEnd: Date;
  publishedAt: Date | null;
  /** 没有更晚的一组 = 这就是最新一期（canonical 规则依赖它） */
  isLatest: boolean;
  prevPeriod: string | null;
  nextPeriod: string | null;
  sections: EditionSection[];
  /** active 方向总数（含本期缺席的），刊头「7 个方向 · 本期 6 个有更新」用 */
  activeDirectionCount: number;
}

/** date(period_end) 的 SQL 片段。聚合键与 URL 参数都是它，只写一处。 */
const periodDaySql = sql<string>`date(${digests.periodEnd}, 'unixepoch')`;

/** 公开可见的 digest：已发布 + 所属方向仍在跟踪。两个导出函数共用一份，别各写一遍。 */
const publicDigest = and(
  eq(digests.status, "published"),
  eq(directions.isActive, true),
);

/**
 * 判定某条 digests 行是否是「同方向、同 date(period_end) 分组内 issue_number
 * 最大」的那条 published 期 —— 即合刊该展示的「获胜」期，而不是补跑残留。
 *
 * 复现路径是生产可达的：ensureDigestShell 对新 workflowInstanceId 总是插新行
 * （issueNumber = max+1），(direction_id, period_end) 上没有唯一索引（唯一索
 * 引只在 (direction_id, issue_number)），全仓也没有 delete(digests)；管理页
 * 「立即开一期」的注释写着「总是新开一期」并传 periodEnd: now —— 同一 UTC 日
 * 对同一方向手动补跑一次即可撞出两条 published digest。getEditionByPeriod
 * 与 listEditionPeriods 都必须只认「获胜」的那条，否则会出现刊头写「N 篇」
 * 点进 /gallery/w/$period 却数出另一个数（这个模块曾经真实犯过这个错：
 * listEditionPeriods 的 pickCount 一度是对全组 published digests 聚合，没
 * 排除掉被取代的残留期）。
 *
 * 用相关子查询而不是 JS 数组：listEditionPeriods 要一次性跨多个 period 判
 * 定，没有像 getEditionByPeriod 那样先按单个 target 分组、再在 JS 里 dedupe
 * 的机会；子查询也是本仓库对付「候选集合可能变大、别传 inArray」的既定写法。
 *
 * 子查询里的表名与别名（"digests riv"）手写、不插值 digests 表对象：Drizzle
 * 在子查询自身是单表 select 时会把插值 Column 的表限定符剥掉，写成
 * `.from(digests)` 之类类型安全的形式会退化成自引用、静默漏判 —— 与
 * paper-feedback.ts 的 likeCountSql 是同一个坑、同一个规避写法（手写子查询
 * 侧的表名，只插值外层查询的 Column）。这里插值的三处 `digests.*` 都活在多
 * 表 join 的外层查询里（getEditionByPeriod 的 rows 查询、listEditionPeriods
 * 的 rows / pickRows 查询都 innerJoin 了 directions），限定符不会被剥。
 */
const isWinningDigest = sql`NOT EXISTS (
  SELECT 1 FROM digests riv
  WHERE riv.direction_id = ${digests.directionId}
    AND riv.status = 'published'
    AND date(riv.period_end, 'unixepoch') = date(${digests.periodEnd}, 'unixepoch')
    AND riv.issue_number > ${digests.issueNumber}
)`;

/**
 * 合刊 = 同一个 date(period_end) 下全部「获胜」的 published 期。period 传
 * null 取最新那组。
 *
 * 为什么按日期字符串而不是时间戳分组：period_end 是 23:59:59 这样的精确值，
 * 未来若挖掘管线改动边界算法（哪怕差 1 秒）按时间戳分组就会把一期劈成两组。
 * digests 表一年也就几百行，date() 不走索引无所谓。
 */
export async function getEditionByPeriod(
  db: Db,
  period: string | null,
): Promise<EditionDetail | null> {
  const target =
    period ??
    (
      await db
        .select({ day: sql<string | null>`max(${periodDaySql})` })
        .from(digests)
        .innerJoin(directions, eq(digests.directionId, directions.id))
        .where(publicDigest)
    )[0]?.day ??
    null;
  if (!target) return null;

  // rows / neighbours / activeDirectionCount 互不依赖（neighbours 与
  // activeDirectionCount 甚至不依赖 rows），并成一批而不是三次串行往返。
  const [rows, [neighbours], [activeRow]] = await Promise.all([
    db
      .select({
        digestId: digests.id,
        directionId: digests.directionId,
        directionSlug: directions.slug,
        directionName: directions.name,
        directionCreatedAt: directions.createdAt,
        sortOrder: directions.sortOrder,
        issueNumber: digests.issueNumber,
        title: digests.title,
        content: digests.content,
        periodStart: digests.periodStart,
        periodEnd: digests.periodEnd,
        publishedAt: digests.publishedAt,
      })
      .from(digests)
      .innerJoin(directions, eq(digests.directionId, directions.id))
      .where(and(publicDigest, eq(periodDaySql, target)))
      .orderBy(
        asc(directions.sortOrder),
        asc(directions.slug),
        desc(digests.issueNumber),
      ),
    // prev/next 用字符串 < / > 比较：只因为 date() 产出的 YYYY-MM-DD 恰好
    // 字典序 == 时间序才成立，换成别的日期格式（比如本地化格式）就会错。
    db
      .select({
        prev: sql<
          string | null
        >`max(case when ${periodDaySql} < ${target} then ${periodDaySql} end)`,
        next: sql<
          string | null
        >`min(case when ${periodDaySql} > ${target} then ${periodDaySql} end)`,
      })
      .from(digests)
      .innerJoin(directions, eq(digests.directionId, directions.id))
      .where(publicDigest),
    db
      .select({ n: sql<number>`count(*)` })
      .from(directions)
      .where(eq(directions.isActive, true)),
  ]);
  if (rows.length === 0) return null;

  // 一个方向在一组里只留期号最大的那期（补跑/夹具可能有多期）。rows 已按
  // sortOrder→slug→issueNumber desc 排好，所以「首次见到该方向」就是要留的那条。
  const seen = new Set<string>();
  const chosen = rows.filter((r) => {
    if (seen.has(r.directionId)) return false;
    seen.add(r.directionId);
    return true;
  });

  // picks 一次全取（一周约 60 行），JS 里分组并切前 N 篇：pickCount 顺便就有了，
  // 也不必假设 rank 从 1 连续（软删过的期会缺号）。
  //
  // leftJoin whiteboardImages（不是画廊流的 innerJoin）：兜底发布的期会有白
  // 板管线未完成的论文，清单必须完整，前端降级成文字条目。groupBy(digestId,
  // papers.id) 不是可删的装饰——whiteboard_images 的 (paper_id, is_default)
  // 索引不是唯一索引，一篇论文若意外有两张默认图，leftJoin 会把它的 pick 行
  // 扇出成两条重复，直接污染 pickCount（就是上面 isWinningDigest 那条注释
  // 讲的同一类「两处口径打架」问题，这里是靠 groupBy 而不是靠子查询防）。
  //
  // 只过滤 deletedAt、刻意不过滤 isPublic/isListedInGallery/status：清单口
  // 径与 getPublishedIssueDetail 的 paperRows 查询一致（软删论文的 /p/$id
  // 已 404 是唯一必须挡的情形；isPublic/isListedInGallery 的下架语义留给
  // Phase 3 管理页决策，加在这里会与「期内论文清单必须完整」冲突）——改一处
  // 要同步改另一处。
  //
  // inArray 喂 JS 数组在这里是安全的例外，不是疏漏：chosen 已按方向去重，
  // 长度上限就是 active 方向数；本查询另绑了 whiteboardImages.isDefault 这
  // 一个参数，合计 N+1，要撞上 D1 的 100 参数上限，得先有约 99 个 active 方
  // 向（真实规模是个位数），离上限很远。
  const pickRows = await db
    .select({
      digestId: digestPapers.digestId,
      id: papers.id,
      shortId: papers.shortId,
      title: papers.title,
      recommendationNote: digestPapers.recommendationNote,
      whiteboardImageR2Key: whiteboardImages.imageR2Key,
      rank: digestPapers.rank,
    })
    .from(digestPapers)
    .innerJoin(papers, eq(digestPapers.paperId, papers.id))
    .leftJoin(
      whiteboardImages,
      and(
        eq(whiteboardImages.paperId, papers.id),
        eq(whiteboardImages.isDefault, true),
      ),
    )
    .where(
      and(
        inArray(
          digestPapers.digestId,
          chosen.map((r) => r.digestId),
        ),
        isNull(papers.deletedAt),
      ),
    )
    .groupBy(digestPapers.digestId, papers.id)
    .orderBy(asc(digestPapers.rank));

  const picksByDigest = new Map<string, EditionPick[]>();
  for (const p of pickRows) {
    const list = picksByDigest.get(p.digestId) ?? [];
    list.push({
      id: p.id,
      shortId: p.shortId,
      title: p.title,
      recommendationNote: p.recommendationNote,
      whiteboardImageR2Key: p.whiteboardImageR2Key,
      rank: p.rank,
    });
    picksByDigest.set(p.digestId, list);
  }

  const sections: EditionSection[] = chosen.map((r) => {
    const allPicks = picksByDigest.get(r.digestId) ?? [];
    return {
      directionSlug: r.directionSlug,
      directionName: r.directionName,
      directionCreatedAt: r.directionCreatedAt,
      issueNumber: r.issueNumber,
      title: r.title,
      content: r.content,
      pickCount: allPicks.length,
      picks: allPicks.slice(0, PICKS_PER_SECTION),
    };
  });

  // periodStart / publishedAt 取组内极值而不是第一条：同组内理论上一致，
  // 但补跑可能差一点，取 min/max 才不会让刊头日期取决于排序偶然。
  const startMs = Math.min(...chosen.map((r) => r.periodStart.getTime()));
  const endMs = Math.max(...chosen.map((r) => r.periodEnd.getTime()));
  const publishedMs = chosen
    .map((r) => r.publishedAt?.getTime())
    .filter((v): v is number => typeof v === "number");

  // 无 GROUP BY 的聚合查询恒返回一行（0 匹配也会聚合成 NULL/0 的那一行），
  // 数组解构从不为空；这里仍用 ?. 是防御性风格而非真的不确定，与
  // store.ts 的 ensureDigestShell 里 `row?.max` 同款，全仓统一这个写法。
  return {
    period: target,
    periodStart: new Date(startMs),
    periodEnd: new Date(endMs),
    publishedAt: publishedMs.length ? new Date(Math.max(...publishedMs)) : null,
    isLatest: neighbours?.next == null,
    prevPeriod: neighbours?.prev ?? null,
    nextPeriod: neighbours?.next ?? null,
    sections,
    activeDirectionCount: activeRow?.n ?? 0,
  };
}

export interface EditionPeriodSummary {
  period: string;
  periodStart: Date;
  periodEnd: Date;
  publishedAt: Date | null;
  /** 该期有更新的方向数 */
  directionCount: number;
  /** 该期入选论文总数 */
  pickCount: number;
}

/** 往期合刊列表（含本期），按 period 倒序。落地页页尾用。 */
export async function listEditionPeriods(
  db: Db,
): Promise<EditionPeriodSummary[]> {
  // rows 与 pickRows 都只统计 isWinningDigest 的那一份：否则被取代的补跑
  // 残留期会被重复计入，导致这里的 pickCount 与 getEditionByPeriod 各栏目
  // pickCount 之和对不上（见 isWinningDigest 顶部注释里的复现路径）。
  const rows = await db
    .select({
      period: periodDaySql,
      startSec: sql<number>`min(${digests.periodStart})`,
      endSec: sql<number>`max(${digests.periodEnd})`,
      publishedSec: sql<number | null>`max(${digests.publishedAt})`,
      directionCount: sql<number>`count(distinct ${digests.directionId})`,
    })
    .from(digests)
    .innerJoin(directions, eq(digests.directionId, directions.id))
    .where(and(publicDigest, isWinningDigest))
    .groupBy(periodDaySql)
    .orderBy(desc(periodDaySql));

  const pickRows = await db
    .select({ period: periodDaySql, n: sql<number>`count(*)` })
    .from(digestPapers)
    .innerJoin(digests, eq(digestPapers.digestId, digests.id))
    .innerJoin(directions, eq(digests.directionId, directions.id))
    .innerJoin(papers, eq(digestPapers.paperId, papers.id))
    .where(and(publicDigest, isWinningDigest, isNull(papers.deletedAt)))
    .groupBy(periodDaySql);
  const pickCountByPeriod = new Map(pickRows.map((r) => [r.period, r.n]));

  // timestamp 模式存的是秒；聚合函数绕过了 drizzle 的列映射，必须自己 ×1000
  return rows.map((r) => ({
    period: r.period,
    periodStart: new Date(r.startSec * 1000),
    periodEnd: new Date(r.endSec * 1000),
    publishedAt:
      r.publishedSec == null ? null : new Date(r.publishedSec * 1000),
    directionCount: r.directionCount,
    pickCount: pickCountByPeriod.get(r.period) ?? 0,
  }));
}
