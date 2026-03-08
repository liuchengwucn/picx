ALTER TABLE papers ADD COLUMN is_listed_in_gallery INTEGER DEFAULT 0 NOT NULL;

UPDATE papers
SET is_listed_in_gallery = 1
WHERE is_public = 1;

DROP INDEX IF EXISTS papers_public_idx;
CREATE INDEX papers_public_idx ON papers(is_public, is_listed_in_gallery, published_at);
