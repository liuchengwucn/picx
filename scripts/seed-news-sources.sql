-- News aggregation seed sources. Idempotent: INSERT OR IGNORE by fixed readable ids.
-- Apply: npx wrangler d1 execute DB --local --file=scripts/seed-news-sources.sql  (and --remote at rollout)
-- Feed URLs verified 2026-07-30 via curl (200 + XML body) unless noted otherwise.

INSERT OR IGNORE INTO news_sources (id, type, name, config, enabled, consecutive_failures, created_at) VALUES
  ('src-openai-blog',    'rss', 'OpenAI Blog',             '{"url":"https://openai.com/news/rss.xml"}', 1, 0, strftime('%s','now')),
  -- Anthropic has no official RSS feed (anthropic.com/news/rss.xml -> 404); this is the
  -- community-maintained mirror from github.com/Olshansk/rss-feeds, verified valid RSS 2.0.
  ('src-anthropic-news', 'rss', 'Anthropic News',          '{"url":"https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml"}', 1, 0, strftime('%s','now')),
  ('src-deepmind-blog',  'rss', 'Google DeepMind Blog',    '{"url":"https://deepmind.google/blog/rss.xml"}', 1, 0, strftime('%s','now')),
  -- Meta AI feed could not be verified: /blog/rss/ returned 404 (bot UA) and 400 (browser UA);
  -- historically valid path, may be geo/bot-blocked. Re-check manually before enabling.
  ('src-meta-ai-blog',   'rss', 'Meta AI Blog',            '{"url":"https://ai.meta.com/blog/rss/"}', 0, 0, strftime('%s','now')),
  ('src-mistral-news',   'rss', 'Mistral AI News',         '{"url":"https://mistral.ai/rss.xml"}', 1, 0, strftime('%s','now')),
  ('src-qwen-blog',      'rss', 'Qwen Blog',               '{"url":"https://qwenlm.github.io/blog/index.xml"}', 1, 0, strftime('%s','now')),
  ('src-hf-blog',        'rss', 'Hugging Face Blog',       '{"url":"https://huggingface.co/blog/feed.xml"}', 1, 0, strftime('%s','now')),
  ('src-karpathy-blog',  'rss', 'Andrej Karpathy',         '{"url":"https://karpathy.bearblog.dev/feed/"}', 1, 0, strftime('%s','now')),
  ('src-lilog',          'rss', 'Lil''Log (Lilian Weng)',  '{"url":"https://lilianweng.github.io/index.xml"}', 1, 0, strftime('%s','now')),
  ('src-ahead-of-ai',    'rss', 'Ahead of AI (Raschka)',   '{"url":"https://magazine.sebastianraschka.com/feed"}', 1, 0, strftime('%s','now')),
  ('src-interconnects',  'rss', 'Interconnects',           '{"url":"https://www.interconnects.ai/feed"}', 1, 0, strftime('%s','now')),
  ('src-simonwillison',  'rss', 'Simon Willison',          '{"url":"https://simonwillison.net/atom/everything/"}', 1, 0, strftime('%s','now')),
  ('src-hn',             'hn',  'Hacker News',             '{"queries":["LLM","OpenAI","Anthropic","DeepSeek","Gemini","Qwen","Mistral","llama","pretraining","transformer"],"minPoints":40}', 1, 0, strftime('%s','now')),
  -- X 资讯账号（RSSHUB_BASE_URL 就绪前保持 disabled；用户部署 RSSHub 后手动置 enabled=1）
  ('src-x-karpathy',     'rsshub', 'X @karpathy',          '{"route":"/twitter/user/karpathy"}', 0, 0, strftime('%s','now')),
  ('src-x-akhaliq',      'rsshub', 'X @_akhaliq',          '{"route":"/twitter/user/_akhaliq"}', 0, 0, strftime('%s','now')),
  ('src-x-iscienceluvr', 'rsshub', 'X @iScienceLuvr',      '{"route":"/twitter/user/iScienceLuvr"}', 0, 0, strftime('%s','now'));
