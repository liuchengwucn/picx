ALTER TABLE `news_stories` ADD `summarized_at` integer;--> statement-breakpoint
-- 回填：当前 dirty = 0 的行都是真正 summarize 成功过的（生产核对：494 行 clean，
-- 全部有 zh-cn 标题；孤儿 0 行）。迁移里先填一次，是为了让新代码部署的那一刻
-- 列表不会瞬间空白；部署完成后还要再跑一次同样的补偿回填，捞回「迁移已应用、
-- 新代码未部署」窗口里被旧 summarize 置为 dirty = 0 却没写 summarized_at 的行
-- ——那些行 dirty 已是 0，summarize 不会再碰它们，漏了就永久不可见。
UPDATE `news_stories` SET `summarized_at` = `updated_at` WHERE `dirty` = 0;
