-- ============================================================================
-- Migration: Migrate summary to multilingual summaries JSON structure
-- Date: 2026-03-06
-- Reason: Support multiple languages for paper summaries with flexible structure
-- ============================================================================

-- WARNING: This is a DESTRUCTIVE migration that cannot be rolled back
--
-- IMPACT ANALYSIS:
-- 1. All existing paper analysis results will be PERMANENTLY DELETED
-- 2. Users must regenerate all paper analyses after this migration
-- 3. R2 objects (mindmap images) will become orphaned and remain in storage
--    - These orphaned images will not be automatically cleaned up
--    - Manual R2 cleanup may be required to reclaim storage space
-- 4. Credit transactions and paper metadata will NOT be affected
--
-- RECOMMENDED ACTIONS BEFORE MIGRATION:
-- 1. (Optional) Backup paper_results table:
--    CREATE TABLE `paper_results_backup` AS SELECT * FROM `paper_results`;
-- 2. (Optional) Export list of R2 keys for cleanup:
--    SELECT mindmap_image_r2_key FROM `paper_results` WHERE mindmap_image_r2_key IS NOT NULL;
-- 3. Notify users about the need to regenerate analyses
--
-- ============================================================================

-- Step 1: Clear all existing paper_results data
-- This is necessary because we're changing from single summary to JSON structure
DELETE FROM `paper_results`;

-- Step 2: Drop the old summary column
ALTER TABLE `paper_results` DROP COLUMN `summary`;

-- Step 3: Add new summaries column (JSON type)
-- This will store multiple language versions: {"en": "...", "zh": "...", ...}
ALTER TABLE `paper_results` ADD `summaries` text NOT NULL DEFAULT '{}';
