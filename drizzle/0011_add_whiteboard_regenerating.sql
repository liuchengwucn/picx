-- Custom SQL migration file, put your code below! --

-- Add whiteboard_regenerating column to papers table
ALTER TABLE `papers` ADD COLUMN `whiteboard_regenerating` integer DEFAULT 0 NOT NULL;
