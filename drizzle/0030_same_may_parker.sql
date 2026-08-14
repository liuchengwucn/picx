CREATE TABLE `assistant_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`body` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_skills_user_name_uq` ON `assistant_skills` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `assistant_skills_user_idx` ON `assistant_skills` (`user_id`,`updated_at`);