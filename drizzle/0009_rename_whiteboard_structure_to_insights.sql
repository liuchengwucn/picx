-- Rename whiteboard_structure column to whiteboard_insights
ALTER TABLE `paper_results` RENAME COLUMN `whiteboard_structure` TO `whiteboard_insights`;
--> statement-breakpoint

-- Update existing prompt templates to use new placeholder
UPDATE `whiteboard_prompts`
SET `prompt_template` = REPLACE(`prompt_template`, '{whiteboardMarkdown}', '{whiteboardInsights}')
WHERE `prompt_template` LIKE '%{whiteboardMarkdown}%';
