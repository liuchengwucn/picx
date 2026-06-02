-- Custom SQL migration file, put your code below! --

-- Create tweet_queue table: delivery log for the X bot.
-- Each selected paper is pushed to Telegram for manual posting; one row per paper
-- (paper_id unique) for dedup so the same paper is never pushed twice.
CREATE TABLE IF NOT EXISTS `tweet_queue` (
  `id` text PRIMARY KEY NOT NULL,
  `paper_id` text NOT NULL UNIQUE,
  `caption` text NOT NULL,
  `status` text NOT NULL,
  `sent_at` integer,
  `error_msg` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tweet_queue_status_idx` ON `tweet_queue` (`status`);
