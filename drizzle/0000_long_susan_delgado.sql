CREATE TABLE `credit_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`type` text NOT NULL,
	`related_paper_id` text,
	`description` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`related_paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `credit_transactions_user_id_idx` ON `credit_transactions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `paper_results` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`summary` text NOT NULL,
	`mindmap_structure` text NOT NULL,
	`mindmap_image_r2_key` text,
	`image_prompt` text NOT NULL,
	`processing_time_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `paper_results_paper_id_idx` ON `paper_results` (`paper_id`);--> statement-breakpoint
CREATE TABLE `papers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text,
	`pdf_r2_key` text NOT NULL,
	`file_size` integer NOT NULL,
	`page_count` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `papers_user_id_idx` ON `papers` (`user_id`,`deleted_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `papers_status_idx` ON `papers` (`status`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer,
	`image` text,
	`credits` integer DEFAULT 10 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);