-- ============================================================================
-- Migration: Add summary_language column to paper_results
-- Date: 2026-03-06
-- Reason: Support bilingual paper summaries (English and Simplified Chinese)
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
-- This is necessary because the new summary_language field changes the data structure
-- and existing summaries are not tagged with a language
DELETE FROM `paper_results`;

-- Step 2: Add summary_language column to paper_results table
-- Default value is 'en' (English) for consistency with the application
ALTER TABLE `paper_results` ADD `summary_language` text DEFAULT 'en' NOT NULL;
