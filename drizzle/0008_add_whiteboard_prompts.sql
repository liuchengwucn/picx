-- Custom SQL migration file, put your code below! --

-- Create whiteboard_prompts table for storing user's custom prompt templates
CREATE TABLE IF NOT EXISTS `whiteboard_prompts` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `name` text NOT NULL,
  `prompt_template` text NOT NULL,
  `is_default` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Create composite index on user_id and is_default for efficient lookups
CREATE INDEX IF NOT EXISTS `whiteboard_prompts_user_id_idx` ON `whiteboard_prompts` (`user_id`, `is_default`);
