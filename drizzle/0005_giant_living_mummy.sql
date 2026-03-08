-- Custom SQL migration file, put your code below! --

-- Create user_api_configs table for BYOK (Bring Your Own Key) feature
CREATE TABLE `user_api_configs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `name` text NOT NULL,
  `openai_api_key` text NOT NULL,
  `openai_base_url` text NOT NULL,
  `openai_model` text NOT NULL,
  `gemini_api_key` text NOT NULL,
  `gemini_base_url` text NOT NULL,
  `gemini_model` text NOT NULL,
  `is_default` integer DEFAULT 0 NOT NULL,
  `last_tested_at` integer,
  `openai_test_status` text DEFAULT 'untested',
  `gemini_test_status` text DEFAULT 'untested',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Create index on user_id for efficient lookups
CREATE INDEX `idx_user_api_configs_user_id` ON `user_api_configs` (`user_id`);
--> statement-breakpoint
-- Create composite index on user_id and is_default for finding default configs
CREATE INDEX `idx_user_api_configs_user_default` ON `user_api_configs` (`user_id`, `is_default`);