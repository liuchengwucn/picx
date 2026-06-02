-- Gallery uniqueness (问题②根治): 同一 source_url 在 gallery 集合中至多一行。
-- Partial unique index 只约束 is_listed_in_gallery=1 且未删除、source_url 非空的行;
-- 私有论文(is_listed_in_gallery=0)与已删除论文不受约束, 可重复。
-- source_url 的 canonical 形式由写入方 arxiv-cron 保证(见 src/lib/arxiv.ts)。
CREATE UNIQUE INDEX `papers_gallery_source_url_unique` ON `papers` (`source_url`) WHERE `is_listed_in_gallery` = 1 and `deleted_at` is null and `source_url` is not null;
