-- Clear existing paper_results data (users need to regenerate)
DELETE FROM `paper_results`;

-- Add summary_language column to paper_results table
ALTER TABLE `paper_results` ADD `summary_language` text DEFAULT 'en' NOT NULL;
