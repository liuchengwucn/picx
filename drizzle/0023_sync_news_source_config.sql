-- Data-sync migration for news_sources rows inserted by earlier seed versions.
-- scripts/seed-news-sources.sql uses INSERT OR IGNORE, so config/name/enabled fixes
-- in the seed file never reach already-inserted rows; this migration applies them.
-- All statements are idempotent UPDATEs keyed by fixed source id — safe to re-run anywhere.

-- minimax/zhipu RSSHub routes renamed 2026-08-04 (old routes removed on the RSSHub side)
UPDATE news_sources SET config = '{"route":"/minimax/blog"}', name = 'MiniMax Blog', consecutive_failures = 0 WHERE id = 'src-minimax-news';
UPDATE news_sources SET config = '{"route":"/zhipu/research"}', name = '智谱 Research', consecutive_failures = 0 WHERE id = 'src-zhipu-news';
-- HN enabled 2026-08-04 (seeded disabled at first)
UPDATE news_sources SET enabled = 1, consecutive_failures = 0 WHERE id = 'src-hn';
-- Meta AI official feed rejects non-browser sessions; switched to the community mirror
UPDATE news_sources SET config = '{"url":"https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_meta_ai.xml"}', enabled = 1, consecutive_failures = 0 WHERE id = 'src-meta-ai-blog';
-- Anthropic Research mirror titles carry scraped concatenation artifacts; opt into title cleaning
UPDATE news_sources SET config = json_set(config, '$.titleClean', 'scraped-research') WHERE id = 'src-anthropic-research';
