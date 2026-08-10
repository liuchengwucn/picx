import { and, type Column, eq, type SQL, sql } from "drizzle-orm";
import { paperFeedback } from "#/db/schema";

/**
 * 论文赞数 = paper_feedback 里 vote = 1 的行数(踩不计)。
 *
 * 「赞」的口径只在这个文件里定义, 两种形态同源, 调用处不要手写 vote = 1:
 * - likeCountSql: 多表 join 查询里的标量子查询片段(gallery 列表 / 简报期内清单)
 * - likeFilter: 单表 count 查询的 where 条件(论文详情页 procedure 与它的 SSR loader)
 * 将来口径变了(比如「vote = 1 且投票者未被封禁」), 改这两个函数即可, 不会漏掉某个页面。
 *
 * likeCountSql 有两个陷阱, 动它之前先读:
 * 1. 只能用在多表 join 的查询里。多表上下文插值 Column 会保留表限定符
 *    ("papers"."id"); 单表查询里 Drizzle 会把限定符剥掉, 子查询于是退化成
 *    自引用(pf.paper_id = "paper_id"), 静默恒真/恒 NULL 而不报错。
 *    单表场景请改用 likeFilter + count()。
 * 2. 表名 paper_feedback 与别名 pf 都手写, 不插值 paperFeedback 表对象:
 *    子查询要的是一份与外层查询彼此独立的引用, 手写别名最直白。
 */
export function likeCountSql(paperIdColumn: Column): SQL<number> {
  return sql<number>`(select count(*) from paper_feedback pf where pf.paper_id = ${paperIdColumn} and pf.vote = 1)`;
}

/**
 * 单篇论文赞数的 where 条件, 配 select({ value: count() }).from(paperFeedback) 用。
 * 与 likeCountSql 同一口径, 只是形态不同(见本文件顶部注释)。
 */
export function likeFilter(paperId: string) {
  return and(eq(paperFeedback.paperId, paperId), eq(paperFeedback.vote, 1));
}
