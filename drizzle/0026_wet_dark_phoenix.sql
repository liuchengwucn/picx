CREATE TABLE `paper_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`markdown_r2_key` text NOT NULL,
	`source` text DEFAULT 'mineru' NOT NULL,
	`image_count` integer DEFAULT 0 NOT NULL,
	`char_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_contents_paper_id_unique` ON `paper_contents` (`paper_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_paper_results` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`summaries` text NOT NULL,
	`tldr` text,
	`categories` text,
	`tags` text,
	`summary_language` text DEFAULT 'en' NOT NULL,
	`whiteboard_insights` text,
	`processing_time_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_paper_results`("id", "paper_id", "summaries", "tldr", "categories", "tags", "summary_language", "whiteboard_insights", "processing_time_ms", "created_at") SELECT "id", "paper_id", "summaries", "tldr", "categories", "tags", "summary_language", "whiteboard_insights", "processing_time_ms", "created_at" FROM `paper_results`;--> statement-breakpoint
DROP TABLE `paper_results`;--> statement-breakpoint
ALTER TABLE `__new_paper_results` RENAME TO `paper_results`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `paper_results_paper_id_idx` ON `paper_results` (`paper_id`);--> statement-breakpoint
ALTER TABLE `papers` ADD `mineru_batch_id` text;