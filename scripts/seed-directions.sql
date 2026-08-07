-- Direction digest seed: ai4formath. Idempotent: INSERT OR IGNORE by fixed readable ids.
-- Apply: mac npx wrangler d1 execute DB --local --file=scripts/seed-directions.sql  (and --remote at rollout)

INSERT OR IGNORE INTO directions (id, slug, name, focus_brief, is_active, sort_order, created_at, updated_at) VALUES
  ('dir-ai4formath', 'ai4formath',
   '{"zh-cn":"AI 形式化数学","zh-tw":"AI 形式化數學","en":"AI for Formal Math","ja":"AI形式化数学"}',
   '当前关注：(1) 自动定理证明（neural theorem proving、proof search、premise selection，尤其 Lean 4 生态）；(2) 自动形式化（autoformalization，自然语言数学到形式语言的翻译，数学库建设）；(3) LLM 数学推理与形式验证的结合（如 IMO/Putnam 级别问题的形式化求解）。口味：偏好有可复现工件（代码/基准/Lean 库）的工作，重视方法上的真实增量；对纯 prompt 工程包装、无消融的 benchmark 刷分、以及与形式化无关的泛数学推理论文不感兴趣。社区动态（Lean Zulip、Mathlib 重大进展、AlphaProof 类项目发布）与论文同等重要。',
   1, 0, strftime('%s','now'), strftime('%s','now'));

INSERT OR IGNORE INTO direction_sources (id, direction_id, adapter_type, config, enabled, consecutive_failures, created_at) VALUES
  ('dsrc-ai4formath-arxiv-atp', 'dir-ai4formath', 'arxiv_query',
   '{"query":"cat:cs.LO AND (all:\"theorem proving\" OR all:\"proof search\" OR all:\"premise selection\")","maxResults":50}',
   1, 0, strftime('%s','now')),
  ('dsrc-ai4formath-arxiv-autoform', 'dir-ai4formath', 'arxiv_query',
   '{"query":"all:\"autoformalization\" OR all:\"neural theorem proving\" OR (all:\"Lean 4\" AND cat:cs.AI)","maxResults":50}',
   1, 0, strftime('%s','now')),
  -- Lean 社区博客（feed URL 由 Step 1 验证后确认）
  ('dsrc-ai4formath-leanblog', 'dir-ai4formath', 'rss',
   '{"url":"https://leanprover-community.github.io/blog/rss.xml"}',
   1, 0, strftime('%s','now'));
