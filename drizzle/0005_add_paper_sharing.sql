-- Add sharing fields to papers table
ALTER TABLE papers ADD COLUMN is_public INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE papers ADD COLUMN published_at INTEGER;

-- Create index for public papers query
CREATE INDEX papers_public_idx ON papers(is_public, published_at);
