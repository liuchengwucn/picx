-- Direction digest seed: formal-math. Idempotent by fixed readable ids:
-- directions 用 INSERT OR IGNORE（focus_brief 可能已被用户演化，seed 不得覆盖）；
-- arXiv 源用 upsert（ON CONFLICT DO UPDATE config），重跑 seed 即可下发新查询。
-- Apply: mac npx wrangler d1 execute DB --local --file=scripts/seed-directions.sql  (and --remote at rollout)
--
-- id 里的 "ai4formath" 是历史名（slug 2026-08 改成 formal-math，因为 4 念 for、
-- 紧跟的 formal 又是 for 开头）。id 刻意没跟着改：它被 direction_sources、digests、
-- direction_candidates 三张表外键引用，而 D1 不支持事务，级联改名中途失败会留下
-- 孤儿行；id 又从不出现在 URL 里。所以这里 id 与 slug 不一致是有意的，不是漏改。

INSERT OR IGNORE INTO directions (id, slug, name, focus_brief, is_active, sort_order, created_at, updated_at) VALUES
  ('dir-ai4formath', 'formal-math',
   '{"zh-cn":"AI 形式化数学","zh-tw":"AI 形式化數學","en":"AI for Formal Math","ja":"AI形式化数学"}',
   '当前关注：(1) 自动定理证明（neural theorem proving、proof search、premise selection，尤其 Lean 4 生态）；(2) 自动形式化（autoformalization，自然语言数学到形式语言的翻译，数学库建设）；(3) LLM 数学推理与形式验证的结合（如 IMO/Putnam 级别问题的形式化求解）。口味：偏好有可复现工件（代码/基准/Lean 库）的工作，重视方法上的真实增量；对纯 prompt 工程包装、无消融的 benchmark 刷分、以及与形式化无关的泛数学推理论文不感兴趣。社区动态（Lean Zulip、Mathlib 重大进展、AlphaProof 类项目发布）与论文同等重要。',
   1, 0, strftime('%s','now'), strftime('%s','now'));

INSERT INTO direction_sources (id, direction_id, adapter_type, config, enabled, consecutive_failures, created_at) VALUES
  ('dsrc-ai4formath-arxiv-atp', 'dir-ai4formath', 'arxiv_query',
   '{"query":"(cat:cs.LO OR cat:cs.AI OR cat:cs.LG OR cat:math.LO) AND (all:\"theorem proving\" OR all:\"proof search\" OR all:\"premise selection\" OR all:\"proof assistant\")","maxResults":50}',
   1, 0, strftime('%s','now')),
  ('dsrc-ai4formath-arxiv-autoform', 'dir-ai4formath', 'arxiv_query',
   '{"query":"all:\"autoformalization\" OR all:\"formal mathematics\" OR all:\"Lean 4\" OR all:\"mathlib\" OR all:\"miniF2F\"","maxResults":50}',
   1, 0, strftime('%s','now'))
ON CONFLICT(id) DO UPDATE SET config = excluded.config;

-- Lean 社区博客（feed URL 已验证 200）
INSERT OR IGNORE INTO direction_sources (id, direction_id, adapter_type, config, enabled, consecutive_failures, created_at) VALUES
  ('dsrc-ai4formath-leanblog', 'dir-ai4formath', 'rss',
   '{"url":"https://leanprover-community.github.io/blog/rss.xml"}',
   1, 0, strftime('%s','now'));
