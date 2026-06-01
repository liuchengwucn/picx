-- Add multilingual tldr column to paper_results for gallery cards.
-- Nullable: existing rows have no tldr; the API falls back to extracting
-- the Overview section from `summaries` at read time.
ALTER TABLE `paper_results` ADD COLUMN `tldr` text;
