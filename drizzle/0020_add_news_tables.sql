CREATE TABLE `news_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`url_hash` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text,
	`author` text,
	`published_at` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`signals` text,
	`media` text,
	`extra` text,
	`relevance_score` integer,
	`embedding` blob,
	`story_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `news_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `news_stories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_items_url_hash_unique` ON `news_items` (`url_hash`);--> statement-breakpoint
CREATE INDEX `news_items_status_idx` ON `news_items` (`status`,`fetched_at`);--> statement-breakpoint
CREATE INDEX `news_items_story_idx` ON `news_items` (`story_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `news_items_source_idx` ON `news_items` (`source_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `news_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_fetched_at` integer,
	`last_error` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `news_sources_enabled_idx` ON `news_sources` (`enabled`,`type`);--> statement-breakpoint
CREATE TABLE `news_stories` (
	`id` text PRIMARY KEY NOT NULL,
	`short_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`primary_item_id` text,
	`centroid` blob NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`source_count` integer DEFAULT 0 NOT NULL,
	`signals_summary` text,
	`tags` text,
	`dirty` integer DEFAULT true NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_stories_short_id_unique` ON `news_stories` (`short_id`);--> statement-breakpoint
CREATE INDEX `news_stories_status_first_seen_idx` ON `news_stories` (`status`,`first_seen_at`);--> statement-breakpoint
CREATE INDEX `news_stories_status_activity_idx` ON `news_stories` (`status`,`last_activity_at`);--> statement-breakpoint
CREATE INDEX `news_stories_dirty_idx` ON `news_stories` (`dirty`);