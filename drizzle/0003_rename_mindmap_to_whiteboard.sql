-- Migration: Rename mindmap columns to whiteboard
-- Date: 2026-03-06

-- Rename mindmap_structure to whiteboard_structure
ALTER TABLE paper_results RENAME COLUMN mindmap_structure TO whiteboard_structure;

-- Rename mindmap_image_r2_key to whiteboard_image_r2_key
ALTER TABLE paper_results RENAME COLUMN mindmap_image_r2_key TO whiteboard_image_r2_key;
