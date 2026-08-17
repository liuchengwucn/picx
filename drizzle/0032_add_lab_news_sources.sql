-- Data migration: add 10 independent AI lab / research org feeds as news sources.
-- scripts/seed-news-sources.sql only runs on fresh setups, so already-deployed
-- environments need this migration to pick up the new rows. INSERT OR IGNORE keyed by
-- fixed readable ids — idempotent, safe to re-run anywhere.
--
-- Background: docs/rsshub-routes-handoff-labs-2026-08.md. Triggered by Prime Intellect's
-- measuring-autonomous-research never being ingested. These labs' posts sit at a median of
-- 2-3 points on HN, so the HN source (minPoints=40) misses 85-100% of them; direct feed
-- subscription is the only way to cover them.
--
-- All 10 feeds verified 2026-08-17 through src/lib/news/adapters/rss.ts fetchFeed:
-- parsed successfully, non-empty, and pubDate is real (not the all-items-are-today
-- fallback that would flood the timeline with backlog on first fetch).
INSERT OR IGNORE INTO news_sources (id, type, name, config, enabled, consecutive_failures, created_at) VALUES
  ('src-ai2-blog',      'rss', 'Ai2 (Allen Institute for AI)', '{"url":"https://allenai.org/rss.xml"}', 1, 0, strftime('%s','now')),
  ('src-eleutherai',    'rss', 'EleutherAI',                   '{"url":"https://blog.eleuther.ai/index.xml"}', 1, 0, strftime('%s','now')),
  ('src-metr',          'rss', 'METR',                         '{"url":"https://metr.org/feed.xml"}', 1, 0, strftime('%s','now')),
  ('src-redwood',       'rss', 'Redwood Research',             '{"url":"https://blog.redwoodresearch.org/feed"}', 1, 0, strftime('%s','now')),
  ('src-arc-prize',     'rss', 'ARC Prize',                    '{"url":"https://arcprize.org/feed.xml"}', 1, 0, strftime('%s','now')),
  ('src-arc-alignment', 'rss', 'Alignment Research Center',    '{"url":"https://www.alignment.org/blog/rss/"}', 1, 0, strftime('%s','now')),
  ('src-palisade',      'rss', 'Palisade Research',            '{"url":"https://palisaderesearch.org/feed.xml"}', 1, 0, strftime('%s','now')),
  ('src-vllm',          'rss', 'vLLM Blog',                    '{"url":"https://vllm.ai/blog/rss.xml"}', 1, 0, strftime('%s','now')),
  ('src-tri-dao',       'rss', 'Tri Dao',                      '{"url":"https://tridao.me/feed.xml"}', 1, 0, strftime('%s','now')),
  ('src-import-ai',     'rss', 'Import AI (Jack Clark)',       '{"url":"https://importai.substack.com/feed"}', 1, 0, strftime('%s','now'));
