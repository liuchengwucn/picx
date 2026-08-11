ALTER TABLE `digests` ADD `proposed_focus_update_status` text;--> statement-breakpoint
ALTER TABLE `directions` ADD `intro` text;--> statement-breakpoint
ALTER TABLE `session` ADD `impersonatedBy` text;--> statement-breakpoint
ALTER TABLE `user` ADD `role` text;--> statement-breakpoint
ALTER TABLE `user` ADD `banned` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `banReason` text;--> statement-breakpoint
ALTER TABLE `user` ADD `banExpires` integer;--> statement-breakpoint
UPDATE `digests` SET `proposed_focus_update_status` = 'pending' WHERE `proposed_focus_update` IS NOT NULL AND trim(`proposed_focus_update`) <> '';