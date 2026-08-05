ALTER TABLE `news_stories` ADD `key_facts` text;--> statement-breakpoint
ALTER TABLE `news_stories` ADD `related` text;--> statement-breakpoint
ALTER TABLE `news_stories` ADD `lead_image` text;--> statement-breakpoint
UPDATE `news_stories` SET `earliest_published_at` = `first_seen_at` WHERE `earliest_published_at` IS NULL;