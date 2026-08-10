import { and, type Column, eq, type SQL, sql } from "drizzle-orm";
import { paperFeedback } from "#/db/schema";

/**
 * paper.getMyFeedback 单次可查的 paperId 上限, 前后端共用这一个数。
 *
 * 90 的由来: inArray 每个 id 占一个绑定参数, 给 D1 单查询 100 个的上限留余量。
 * 后端 zod 的 .max() 与前端 usePaperFeedback 的切块大小必须是同一个值 —— 前端切大了
 * 会被 400 打回, 切小了白发请求。
 */
export const FEEDBACK_BATCH_SIZE = 90;

/**
 * 踩票自由文本理由的长度上限, 前后端共用这一个数。
 *
 * 后端 paper.setFeedback 的 zod `.max()` 与前端 popover 输入框的 `maxLength` 必须是
 * 同一个值, 两边分别写字面量时会静默错开:
 * - 只调高后端: 输入框仍在旧值处截断, 用户敲不满新上限, 后端那点余量永远用不上,
 *   而且"调过了"这件事没人发现。
 * - 只调低后端: 输入框放用户敲到旧上限, 提交才被 BAD_REQUEST 打回 —— 而 setFeedback
 *   的错误现在只弹一句通用失败提示, 说不出"太长了", 用户只会看到踩票莫名失败。
 *
 * 500 的由来: 理由是简报口味校准的 few-shot 素材, 一两句短句足够; 再长的自由文本
 * 反而会挤掉 prompt 里其它样本的位置。
 */
export const FEEDBACK_REASON_TEXT_MAX_LENGTH = 500;

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
