-- Custom SQL migration file, put your code below! --

-- Create tweet_queue table for X (Twitter) bot tweet scheduling
CREATE TABLE IF NOT EXISTS `tweet_queue` (
  `id` text PRIMARY KEY NOT NULL,
  `paper_id` text NOT NULL UNIQUE,
  `lang` text DEFAULT 'en' NOT NULL,
  `caption` text NOT NULL,
  `scheduled_for` integer NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `tweet_id` text,
  `posted_at` integer,
  `error_msg` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tweet_queue_status_schedule_idx` ON `tweet_queue` (`status`, `scheduled_for`);
