CREATE TABLE `digest_papers` (
	`digest_id` text NOT NULL,
	`paper_id` text NOT NULL,
	`rank` integer NOT NULL,
	`recommendation_note` text,
	PRIMARY KEY(`digest_id`, `paper_id`),
	FOREIGN KEY (`digest_id`) REFERENCES `digests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `digest_papers_paper_idx` ON `digest_papers` (`paper_id`);--> statement-breakpoint
CREATE TABLE `digests` (
	`id` text PRIMARY KEY NOT NULL,
	`direction_id` text NOT NULL,
	`issue_number` integer NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`status` text DEFAULT 'generating' NOT NULL,
	`title` text,
	`content` text,
	`proposed_focus_update` text,
	`workflow_instance_id` text NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`direction_id`) REFERENCES `directions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `digests_workflow_instance_id_unique` ON `digests` (`workflow_instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `digests_direction_issue_unique` ON `digests` (`direction_id`,`issue_number`);--> statement-breakpoint
CREATE INDEX `digests_direction_published_idx` ON `digests` (`direction_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `direction_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`direction_id` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'paper' NOT NULL,
	`status` text DEFAULT 'seen' NOT NULL,
	`score` integer,
	`source_meta` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`direction_id`) REFERENCES `directions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `direction_candidates_url_unique` ON `direction_candidates` (`direction_id`,`canonical_url`);--> statement-breakpoint
CREATE INDEX `direction_candidates_status_idx` ON `direction_candidates` (`direction_id`,`status`);--> statement-breakpoint
CREATE TABLE `direction_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`direction_id` text NOT NULL,
	`adapter_type` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_fetched_at` integer,
	`last_attempt_at` integer,
	`last_error` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`direction_id`) REFERENCES `directions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `direction_sources_direction_idx` ON `direction_sources` (`direction_id`);--> statement-breakpoint
CREATE TABLE `directions` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`focus_brief` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `directions_slug_unique` ON `directions` (`slug`);--> statement-breakpoint
CREATE TABLE `hf_signals` (
	`arxiv_id` text PRIMARY KEY NOT NULL,
	`upvotes` integer NOT NULL,
	`date` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hf_signals_date_idx` ON `hf_signals` (`date`);--> statement-breakpoint
CREATE TABLE `paper_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`user_id` text NOT NULL,
	`vote` integer NOT NULL,
	`reason_preset` text,
	`reason_text` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_feedback_paper_user_unique` ON `paper_feedback` (`paper_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `papers` ADD `direction_id` text REFERENCES directions(id);