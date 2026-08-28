ALTER TABLE `news_stories` ADD `summarized_at` integer;--> statement-breakpoint
-- 回填判据是「已有四语正文」，不是 `dirty = 0`。dirty 是工作队列标记：上线时刻
-- 排在队里的 story 里，绝大多数是已成熟、正被跟进重算的那批——恰恰是本次要救的
-- 对象。按 dirty = 0 回填会让它们在修复上线的第一个小时继续隐藏，等于修复自己
-- 先犯一次同样的病（生产核对 2026-08-28：511 行全部四语齐全，其中 17 行 dirty = 1；
-- 占位 story 0 行、孤儿 0 行）。
--
-- 判据落在 title/summary 的 zh-cn 键上：cluster 建的占位行 title 只有 {en: 原标题}、
-- summary 是 excerpt，恒不匹配；summarize 成功写入的一定四语齐全。
--
-- `summarized_at IS NULL` 前置让这条语句幂等，**部署完成后要原样再跑一次**：迁移
-- 已应用、新代码未部署的那个窗口里，旧 summarize 会把 story 置成 dirty = 0 却不
-- 写 summarized_at，而那些行 dirty 已是 0、summarize 不会再碰它们，漏了就永久不可见。
-- 补跑时它对「部署后新建的占位行」与「部署后已自行写入的行」都恒假，重复执行安全。
--
-- 取 updated_at 只是要一个不晚于真实生成时刻的合理值：本列的语义消费点只判
-- NULL / 非 NULL（可见性谓词、IndexNow 首次上架判断），值本身不参与逻辑。
UPDATE `news_stories` SET `summarized_at` = `updated_at`
WHERE `summarized_at` IS NULL
  AND json_extract(`title`, '$."zh-cn"') IS NOT NULL
  AND json_extract(`summary`, '$."zh-cn"') IS NOT NULL;
