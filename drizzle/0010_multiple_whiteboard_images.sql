-- Custom SQL migration file, put your code below! --

-- Create whiteboard_images table for storing multiple whiteboard images per paper
CREATE TABLE IF NOT EXISTS `whiteboard_images` (
  `id` text PRIMARY KEY NOT NULL,
  `paper_id` text NOT NULL,
  `image_r2_key` text NOT NULL,
  `prompt_id` text,
  `is_default` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`prompt_id`) REFERENCES `whiteboard_prompts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- Create index on paper_id for efficient lookups
CREATE INDEX IF NOT EXISTS `whiteboard_images_paper_id_idx` ON `whiteboard_images` (`paper_id`);
--> statement-breakpoint
-- Create composite index on paper_id and is_default for finding default images
CREATE INDEX IF NOT EXISTS `whiteboard_images_paper_id_default_idx` ON `whiteboard_images` (`paper_id`, `is_default`);
--> statement-breakpoint
-- Migrate existing whiteboard images from paper_results to whiteboard_images table
INSERT INTO `whiteboard_images` (`id`, `paper_id`, `image_r2_key`, `prompt_id`, `is_default`, `created_at`)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) as id,
  paper_id,
  whiteboard_image_r2_key as image_r2_key,
  NULL as prompt_id,
  1 as is_default,
  created_at
FROM `paper_results`
WHERE whiteboard_image_r2_key IS NOT NULL;
--> statement-breakpoint
-- Drop old columns from paper_results
ALTER TABLE `paper_results` DROP COLUMN `whiteboard_image_r2_key`;
--> statement-breakpoint
ALTER TABLE `paper_results` DROP COLUMN `image_prompt`;
