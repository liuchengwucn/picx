import { type Column, type SQL, sql } from "drizzle-orm";

/**
 * 论文赞数 = paper_feedback 里 vote = 1 的行数(踩不计)。
 *
 * 「赞」的口径只在这里定义: gallery 列表(paper 路由)与简报期内清单(digest store)
 * 都调这个 helper, 改约定只改一处。
 *
 * 两个陷阱, 动它之前先读:
 * 1. 只能用在多表 join 的查询里。多表上下文插值 Column 会保留表限定符
 *    ("papers"."id"); 单表查询里 Drizzle 会把限定符剥掉, 子查询于是退化成
 *    自引用(pf.paper_id = "paper_id"), 静默恒真/恒 NULL 而不报错。
 * 2. 表名 paper_feedback 与别名 pf 都手写, 不插值 paperFeedback 表对象:
 *    子查询要的是一份与外层查询彼此独立的引用, 手写别名最直白。
 */
export function likeCountSql(paperIdColumn: Column): SQL<number> {
  return sql<number>`(select count(*) from paper_feedback pf where pf.paper_id = ${paperIdColumn} and pf.vote = 1)`;
}
