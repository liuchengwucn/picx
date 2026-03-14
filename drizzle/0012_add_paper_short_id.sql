-- Add short_id column to papers table for short URLs
ALTER TABLE `papers` ADD COLUMN `short_id` text;
CREATE UNIQUE INDEX `papers_short_id_idx` ON `papers`(`short_id`);
