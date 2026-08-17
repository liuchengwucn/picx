-- News aggregation seed sources. Idempotent: INSERT OR IGNORE by fixed readable ids.
-- Apply: npx wrangler d1 execute DB --local --file=scripts/seed-news-sources.sql  (and --remote at rollout)
-- Feed URLs verified 2026-07-30 via curl (200 + XML body) unless noted otherwise.

INSERT OR IGNORE INTO news_sources (id, type, name, config, enabled, consecutive_failures, created_at) VALUES
  ('src-openai-blog',    'rss', 'OpenAI Blog',             '{"url":"https://openai.com/news/rss.xml"}', 1, 0, strftime('%s','now')),
  -- Anthropic has no official RSS feed (anthropic.com/news/rss.xml -> 404); this is the
  -- community-maintained mirror from github.com/Olshansk/rss-feeds, verified valid RSS 2.0.
  ('src-anthropic-news', 'rss', 'Anthropic News',          '{"url":"https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml"}', 1, 0, strftime('%s','now')),
  ('src-deepmind-blog',  'rss', 'Google DeepMind Blog',    '{"url":"https://deepmind.google/blog/rss.xml"}', 1, 0, strftime('%s','now')),
  -- Anthropic engineering/research/red-team pages have no official feeds either; same mirror repo.
  -- Note: the research mirror's item titles carry scraped concatenation artifacts (date/category
  -- prefixes, trailing description text); titleClean='scraped-research' strips them at ingest.
  -- Already-inserted rows are synced by migration drizzle/0023_sync_news_source_config.sql.
  ('src-anthropic-eng',      'rss', 'Anthropic Engineering', '{"url":"https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_engineering.xml"}', 1, 0, strftime('%s','now')),
  ('src-anthropic-research', 'rss', 'Anthropic Research',    '{"url":"https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_research.xml","titleClean":"scraped-research"}', 1, 0, strftime('%s','now')),
  ('src-anthropic-red',      'rss', 'Anthropic Red Team',    '{"url":"https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_red.xml"}', 1, 0, strftime('%s','now')),
  ('src-thinking-machines',  'rss', 'Thinking Machines Lab', '{"url":"https://thinkingmachines.ai/blog/index.xml"}', 1, 0, strftime('%s','now')),
  ('src-cursor-blog',        'rss', 'Cursor Blog',           '{"url":"https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cursor.xml"}', 1, 0, strftime('%s','now')),
  -- Official feed (ai.meta.com/blog/rss/) returns 404/400 for non-browser sessions (re-verified
  -- 2026-08-04); switched to the Olshansk/rss-feeds community mirror (same repo as Anthropic News).
  ('src-meta-ai-blog',   'rss', 'Meta AI Blog',            '{"url":"https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_meta_ai.xml"}', 1, 0, strftime('%s','now')),
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
  -- HN 于 2026-08-04 启用（此前禁用）；已入库的行由迁移 drizzle/0023_sync_news_source_config.sql 同步
  ('src-hn',             'hn',  'Hacker News',             '{"queries":["LLM","OpenAI","Anthropic","DeepSeek","Gemini","Qwen","Mistral","llama","pretraining","transformer"],"minPoints":40}', 1, 0, strftime('%s','now')),
  -- 国产厂商博客：自建 RSSHub（rsshub.picx.dev）自定义路由，verified 2026-08-04（14 路由清单见 docs/rsshub-routes-handoff.md）
  -- 需要 RSSHUB_BASE_URL + RSSHUB_ACCESS_KEY secrets
  ('src-deepseek-news',    'rsshub', 'DeepSeek News',          '{"route":"/deepseek/news"}', 1, 0, strftime('%s','now')),
  ('src-deepseek-updates', 'rsshub', 'DeepSeek API Updates',   '{"route":"/deepseek/updates"}', 1, 0, strftime('%s','now')),
  ('src-kimi-blog',        'rsshub', 'Kimi Blog (Moonshot)',   '{"route":"/kimi/blog"}', 1, 0, strftime('%s','now')),
  ('src-seed-blog',        'rsshub', 'ByteDance Seed Blog',    '{"route":"/byteseed/blog"}', 1, 0, strftime('%s','now')),
  ('src-seed-papers',      'rsshub', 'ByteDance Seed Papers',  '{"route":"/byteseed/papers"}', 1, 0, strftime('%s','now')),
  -- minimax 路由 2026-08-04 由 /minimax/news 改为 /minimax/blog（旧路由已在 RSSHub 侧移除）；已入库的行由迁移 0023 同步
  ('src-minimax-news',     'rsshub', 'MiniMax Blog',           '{"route":"/minimax/blog"}', 1, 0, strftime('%s','now')),
  ('src-hunyuan-blog',     'rsshub', '腾讯混元 Blog',           '{"route":"/hunyuan/blog"}', 1, 0, strftime('%s','now')),
  -- zhipu 路由 2026-08-04 由 /zhipu/news 改为 /zhipu/research（旧路由已在 RSSHub 侧移除）；已入库的行由迁移 0023 同步
  -- 冷缓存首渲染 >30s 远超 15s 超时；依赖 RSSHub 侧缓存 TTL ≥2h，偶发失败靠下轮 cron 自愈
  ('src-zhipu-news',       'rsshub', '智谱 Research',           '{"route":"/zhipu/research"}', 1, 0, strftime('%s','now')),
  ('src-zai-releases',     'rsshub', 'Z.ai Release Notes',     '{"route":"/zai/release-notes"}', 1, 0, strftime('%s','now')),
  -- stepfun 官网无文章索引，models 路由用 HF 模型发布动态；research 路由抓官网研究博客
  ('src-stepfun-models',   'rsshub', 'StepFun 模型发布 (HF)',   '{"route":"/stepfun/models"}', 1, 0, strftime('%s','now')),
  ('src-stepfun-research', 'rsshub', 'StepFun Research',       '{"route":"/stepfun/research"}', 1, 0, strftime('%s','now')),
  ('src-mimo-blog',        'rsshub', '小米 MiMo Blog',          '{"route":"/mimo/blog"}', 1, 0, strftime('%s','now')),
  ('src-mimo-paper',       'rsshub', '小米 MiMo Papers',        '{"route":"/mimo/paper"}', 1, 0, strftime('%s','now')),
  ('src-ernie-blog',       'rsshub', 'Baidu ERNIE Blog',       '{"route":"/ernie/blog"}', 1, 0, strftime('%s','now')),
  -- 中文 AI 媒体（全文路由，verified 2026-08-04）；量子位混有泛科技报道，靠相关性打分层过滤
  ('src-qbitai-news',      'rsshub', '量子位',                  '{"route":"/qbitai/news"}', 1, 0, strftime('%s','now')),
  ('src-jiqizhixin',       'rsshub', '机器之心',                '{"route":"/jiqizhixin/articles"}', 1, 0, strftime('%s','now')),
  -- X 资讯账号（isTweet 标记推文特化；实例已就绪，等用户确认后置 enabled=1）
  ('src-x-karpathy',     'rsshub', 'X @karpathy',          '{"route":"/twitter/user/karpathy","isTweet":true}', 0, 0, strftime('%s','now')),
  ('src-x-akhaliq',      'rsshub', 'X @_akhaliq',          '{"route":"/twitter/user/_akhaliq","isTweet":true}', 0, 0, strftime('%s','now')),
  ('src-x-iscienceluvr', 'rsshub', 'X @iScienceLuvr',      '{"route":"/twitter/user/iScienceLuvr","isTweet":true}', 0, 0, strftime('%s','now')),
  -- 行业内幕/资本/人事类（2026-08-07 补，此前该类别零覆盖，漏掉字节 5 万亿参数模型爆料）。
  -- 均为全站/全科技流，非 AI 内容靠相关性打分层过滤。feed 用 picx-news-bot UA verified 2026-08-07。
  -- Techmeme 是前页精选流（非 River 全量），标题会转述 The Information/Bloomberg 等付费墙独家。
  ('src-techmeme',       'rss',    'Techmeme',        '{"url":"https://www.techmeme.com/feed.xml"}', 1, 0, strftime('%s','now')),
  ('src-techcrunch-ai',  'rss',    'TechCrunch AI',   '{"url":"https://techcrunch.com/category/artificial-intelligence/feed/"}', 1, 0, strftime('%s','now')),
  ('src-verge-ai',       'rss',    'The Verge AI',    '{"url":"https://www.theverge.com/rss/ai-artificial-intelligence/index.xml"}', 1, 0, strftime('%s','now')),
  -- 晚点：RSSHub 官方路由（非自建自定义路由），feed 仅 5 条、日更 2-5 篇，小时级 cron 足够覆盖
  ('src-latepost',       'rsshub', '晚点 LatePost',   '{"route":"/latepost"}', 1, 0, strftime('%s','now'));

-- 独立 AI 实验室 / 研究机构（2026-08-17 补）。立项背景见 docs/rsshub-routes-handoff-labs-2026-08.md：
-- 起因是 Prime Intellect 的 measuring-autonomous-research 零捕获。调研 60+ 候选后的核心结论是
-- 这类实验室的技术文章在 HN 上分数中位数只有 2-3 分，现有 HN 源（minPoints=40）对它们的漏抓率
-- 达 85-100%（连已收录的 Interconnects 都漏 97%），只能靠直接订阅源站覆盖。
-- 以下 10 个均有官方 feed，已用 src/lib/news/adapters/rss.ts 的 fetchFeed 实测通过
-- （解析成功、条目数 >0、pubDate 真实且非「全部为今天」的回退症状），verified 2026-08-17。
-- 无官方 feed 的另 4 个（Prime Intellect / Goodfire / Liquid AI / Epoch AI）走自建 RSSHub 路由，
-- 见上述 handoff 文档，路由交付后再补种子。
INSERT OR IGNORE INTO news_sources (id, type, name, config, enabled, consecutive_failures, created_at) VALUES
  -- 开放模型/开源研究：Ai2 是 OLMo/Molmo 的家；EleutherAI 低频（近 180 天 2 篇）但每篇有分量
  ('src-ai2-blog',      'rss', 'Ai2 (Allen Institute for AI)', '{"url":"https://allenai.org/rss.xml"}', 1, 0, strftime('%s','now')),
  ('src-eleutherai',    'rss', 'EleutherAI',                   '{"url":"https://blog.eleuther.ai/index.xml"}', 1, 0, strftime('%s','now')),
  -- 评测/安全/可解释性：这批在 HN 上几乎完全沉底（METR 漏 89%、Palisade/ARC 近 100%）
  ('src-metr',          'rss', 'METR',                         '{"url":"https://metr.org/feed.xml"}', 1, 0, strftime('%s','now')),
  ('src-redwood',       'rss', 'Redwood Research',             '{"url":"https://blog.redwoodresearch.org/feed"}', 1, 0, strftime('%s','now')),
  ('src-arc-prize',     'rss', 'ARC Prize',                    '{"url":"https://arcprize.org/feed.xml"}', 1, 0, strftime('%s','now')),
  ('src-arc-alignment', 'rss', 'Alignment Research Center',    '{"url":"https://www.alignment.org/blog/rss/"}', 1, 0, strftime('%s','now')),
  -- Palisade 的 feed 混有播客/募捐条目，靠相关性打分层过滤
  ('src-palisade',      'rss', 'Palisade Research',            '{"url":"https://palisaderesearch.org/feed.xml"}', 1, 0, strftime('%s','now')),
  -- 系统/推理：vLLM 是推理引擎事实标准；Tri Dao 个人博客首发 FlashAttention-4 / Mamba-3，
  -- 近 24 个月只有 1 篇上过 HN（30 分），是「有影响力但流量小」的最典型样本
  ('src-vllm',          'rss', 'vLLM Blog',                    '{"url":"https://vllm.ai/blog/rss.xml"}', 1, 0, strftime('%s','now')),
  ('src-tri-dao',       'rss', 'Tri Dao',                      '{"url":"https://tridao.me/feed.xml"}', 1, 0, strftime('%s','now')),
  -- Import AI 是 Jack Clark 的周报（周更，20 篇/180 天），HN 漏抓 100%
  ('src-import-ai',     'rss', 'Import AI (Jack Clark)',       '{"url":"https://importai.substack.com/feed"}', 1, 0, strftime('%s','now'));

-- 独立实验室第二批（2026-08-17）：这 4 家无官方 feed，走自建 RSSHub 自定义路由。
-- 路由规格与实现坑见 docs/rsshub-routes-handoff-labs-2026-08.md，交付报告见
-- docs/rsshub-routes-delivery-labs-2026-08.md。四条路由已用 fetchRsshub 实测通过
-- （条目 20/20/20/10、配图 100%、链接全绝对、严格倒序、pubDate 非回退），verified 2026-08-17。
-- 注意 Liquid AI 的 pubDate 取自文章页 datePublished 而非 sitemap lastmod——后者是「最后修改」，
-- 用它会让老文被改动一次就重新掉回 72h 摄入窗口反复灌入（实测偏差 3-4 天）。
INSERT OR IGNORE INTO news_sources (id, type, name, config, enabled, consecutive_failures, created_at) VALUES
  ('src-prime-intellect', 'rsshub', 'Prime Intellect',  '{"route":"/primeintellect/blog"}', 1, 0, strftime('%s','now')),
  ('src-goodfire',        'rsshub', 'Goodfire',         '{"route":"/goodfire/research"}', 1, 0, strftime('%s','now')),
  ('src-liquid-ai',       'rsshub', 'Liquid AI',        '{"route":"/liquidai/blog"}', 1, 0, strftime('%s','now')),
  -- Epoch 只做 /gradient-updates（长文分析）；/data-insights 是碎片数据卡片，/blog 与 /latest 是重复聚合页。
  -- 该栏目分页无效（?page=2 返回首页内容），条目数上限 10，对 72h 窗口足够
  ('src-epoch-ai',        'rsshub', 'Epoch AI',         '{"route":"/epochai/gradient-updates"}', 1, 0, strftime('%s','now'));
