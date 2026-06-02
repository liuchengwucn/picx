-- Add categories and tags columns to paper_results for gallery discovery.
-- Nullable: existing rows will have NULL; backfill job will populate them.
-- categories: fixed-set slug array (see src/lib/paper-categories.ts).
-- tags: LLM-generated free-form fine-grained tags (lowercase hyphenated).
ALTER TABLE `paper_results` ADD COLUMN `categories` text;
--> statement-breakpoint
ALTER TABLE `paper_results` ADD COLUMN `tags` text;
