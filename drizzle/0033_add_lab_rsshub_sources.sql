-- Data migration: add the 4 independent AI lab blogs that have no official feed and are
-- served through our self-hosted RSSHub instance. Companion to 0032 (the 10 labs that do
-- have official feeds). INSERT OR IGNORE keyed by fixed readable ids — idempotent.
--
-- Route specs and implementation pitfalls: docs/rsshub-routes-handoff-labs-2026-08.md
-- Delivery report: docs/rsshub-routes-delivery-labs-2026-08.md
--
-- All 4 routes verified 2026-08-17 through src/lib/news/adapters/rsshub.ts fetchRsshub:
-- 20/20/20/10 items, 100% with images, all links absolute http(s), strictly descending
-- pubDate, and no all-items-are-today date fallback.
--
-- Liquid AI note: its pubDate comes from the article page's datePublished, NOT the sitemap
-- lastmod. lastmod is a "last modified" stamp (measured 3-4 days off), so using it would let
-- old posts fall back into the 72h ingest window every time the source edits them.
INSERT OR IGNORE INTO news_sources (id, type, name, config, enabled, consecutive_failures, created_at) VALUES
  ('src-prime-intellect', 'rsshub', 'Prime Intellect', '{"route":"/primeintellect/blog"}', 1, 0, strftime('%s','now')),
  ('src-goodfire',        'rsshub', 'Goodfire',        '{"route":"/goodfire/research"}', 1, 0, strftime('%s','now')),
  ('src-liquid-ai',       'rsshub', 'Liquid AI',       '{"route":"/liquidai/blog"}', 1, 0, strftime('%s','now')),
  ('src-epoch-ai',        'rsshub', 'Epoch AI',        '{"route":"/epochai/gradient-updates"}', 1, 0, strftime('%s','now'));
