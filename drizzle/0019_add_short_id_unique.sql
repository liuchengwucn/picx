-- 补齐 papers.short_id 的唯一约束(schema.ts 声明了 .unique(),但手写的 0012 用
-- ALTER ADD COLUMN 无法携带 UNIQUE,导致生产缺少该唯一索引)。
-- 已确认生产 short_id 零空值、零重复,创建唯一索引安全。
CREATE UNIQUE INDEX `papers_short_id_unique` ON `papers` (`short_id`);
