-- Add upvotes column to papers table.
-- Stores HuggingFace Daily Papers upvotes (written by arxiv-cron) for X bot quality filtering.
-- Nullable: user-uploaded / historical papers have no upvotes.
ALTER TABLE `papers` ADD COLUMN `upvotes` integer;
