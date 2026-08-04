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
  -- 科学空间双域名（spaces.ac.cn / kexue.fm），feed 用 spaces.ac.cn，verified 2026-08-03
  ('src-kexue-fm',       'rss', '科学空间 (苏剑林)',        '{"url":"https://spaces.ac.cn/feed"}', 1, 0, strftime('%s','now')),
  -- HN 暂不启用（2026-08-03 用户决定）
  ('src-hn',             'hn',  'Hacker News',             '{"queries":["LLM","OpenAI","Anthropic","DeepSeek","Gemini","Qwen","Mistral","llama","pretraining","transformer"],"minPoints":40}', 0, 0, strftime('%s','now')),
  -- 国产厂商博客：自建 RSSHub（rsshub.picx.dev）自定义路由，verified 2026-08-04（14 路由清单见 docs/rsshub-routes-handoff.md）
  -- 需要 RSSHUB_BASE_URL + RSSHUB_ACCESS_KEY secrets
  ('src-deepseek-news',    'rsshub', 'DeepSeek News',          '{"route":"/deepseek/news"}', 1, 0, strftime('%s','now')),
  ('src-deepseek-updates', 'rsshub', 'DeepSeek API Updates',   '{"route":"/deepseek/updates"}', 1, 0, strftime('%s','now')),
  ('src-kimi-blog',        'rsshub', 'Kimi Blog (Moonshot)',   '{"route":"/kimi/blog"}', 1, 0, strftime('%s','now')),
  ('src-seed-blog',        'rsshub', 'ByteDance Seed Blog',    '{"route":"/byteseed/blog"}', 1, 0, strftime('%s','now')),
  ('src-seed-papers',      'rsshub', 'ByteDance Seed Papers',  '{"route":"/byteseed/papers"}', 1, 0, strftime('%s','now')),
  -- minimax 路由 2026-08-04 由 /minimax/news 改为 /minimax/blog（旧路由已在 RSSHub 侧移除）；已入库的行需手动 UPDATE config
  ('src-minimax-news',     'rsshub', 'MiniMax Blog',           '{"route":"/minimax/blog"}', 1, 0, strftime('%s','now')),
  ('src-hunyuan-blog',     'rsshub', '腾讯混元 Blog',           '{"route":"/hunyuan/blog"}', 1, 0, strftime('%s','now')),
  -- zhipu 路由 2026-08-04 由 /zhipu/news 改为 /zhipu/research（旧路由已在 RSSHub 侧移除）；已入库的行需手动 UPDATE config
  -- 冷缓存首渲染 >30s 远超 15s 超时；依赖 RSSHub 侧缓存 TTL ≥2h，偶发失败靠下轮 cron 自愈
  ('src-zhipu-news',       'rsshub', '智谱 Research',           '{"route":"/zhipu/research"}', 1, 0, strftime('%s','now')),
  ('src-zai-releases',     'rsshub', 'Z.ai Release Notes',     '{"route":"/zai/release-notes"}', 1, 0, strftime('%s','now')),
  -- stepfun 官网无文章索引，models 路由用 HF 模型发布动态；research 路由抓官网研究博客
  ('src-stepfun-models',   'rsshub', 'StepFun 模型发布 (HF)',   '{"route":"/stepfun/models"}', 1, 0, strftime('%s','now')),
  ('src-stepfun-research', 'rsshub', 'StepFun Research',       '{"route":"/stepfun/research"}', 1, 0, strftime('%s','now')),
  ('src-mimo-blog',        'rsshub', '小米 MiMo Blog',          '{"route":"/mimo/blog"}', 1, 0, strftime('%s','now')),
  ('src-mimo-paper',       'rsshub', '小米 MiMo Papers',        '{"route":"/mimo/paper"}', 1, 0, strftime('%s','now')),
  ('src-ernie-blog',       'rsshub', 'Baidu ERNIE Blog',       '{"route":"/ernie/blog"}', 1, 0, strftime('%s','now')),
  -- X 资讯账号（isTweet 标记推文特化；实例已就绪，等用户确认后置 enabled=1）
  ('src-x-karpathy',     'rsshub', 'X @karpathy',          '{"route":"/twitter/user/karpathy","isTweet":true}', 0, 0, strftime('%s','now')),
  ('src-x-akhaliq',      'rsshub', 'X @_akhaliq',          '{"route":"/twitter/user/_akhaliq","isTweet":true}', 0, 0, strftime('%s','now')),
  ('src-x-iscienceluvr', 'rsshub', 'X @iScienceLuvr',      '{"route":"/twitter/user/iScienceLuvr","isTweet":true}', 0, 0, strftime('%s','now'));
