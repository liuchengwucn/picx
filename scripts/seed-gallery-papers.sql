-- 画廊本地开发种子数据（20 篇假论文）。**仅供本地开发，永远不要 --remote 执行。**
--
-- 为什么需要它: 本地 D1 里的论文往往全是 status='failed'、paper_results 与
-- whiteboard_images 空表, 于是 /gallery 一张卡都渲染不出来, 分页 / 无限滚动 /
-- 卡片反馈按钮全都没法在本地验。listPublic (src/integrations/trpc/routers/paper.ts)
-- 的硬条件是: is_public=1 AND is_listed_in_gallery=1 AND status='completed'
-- AND deleted_at IS NULL, 且 **innerJoin whiteboard_images 且 is_default=1**
-- (最容易漏的一条: 没有这行白板, 卡片直接不出现)。
--
-- 前置依赖:
--   1) `user` 表至少有一行 —— papers.user_id 是 NOT NULL 外键, 本脚本用
--      `(SELECT id FROM user ORDER BY id LIMIT 1)` 取真实用户, 空表会报 NOT NULL 失败。
--   2) 方向归属需要 scripts/seed-directions.sql 先跑过 (slug='ai4formath');
--      没跑过也不会失败, 那 5 篇的 direction_id 会是 NULL, 只是方向主页看不到卡。
--
-- 执行 (本地 D1):
--   mac npx wrangler d1 execute picx-db --local --persist-to=.wrangler/state \
--     --file=scripts/seed-gallery-papers.sql
--   注: 别试 `PRAGMA wal_checkpoint(FULL)` —— wrangler d1 execute 会以
--   `not authorized: SQLITE_AUTH` 拒掉这条 pragma。实测不需要: 本地 D1 走
--   miniflare 的 better-sqlite3, 命令退出时写已落盘, 另起的 dev/preview 读得到。
--
-- 配套占位图片 (卡片图走 /api/r2/{whiteboardImageR2Key}, R2 里没有对象就是碎图):
--   dev/preview 读的是 wrangler.jsonc 里的 preview_bucket_name, **不是**生产桶。
--   mac npx wrangler r2 object put \
--     "picx-papers-apac-preview/whiteboards/seed-gallery/placeholder.webp" \
--     --file=public/whiteboard-example.webp --content-type=image/webp \
--     --local --persist-to=.wrangler/state
--   (--persist-to 指向 .wrangler/state 这个父目录, 不是里面的 v3。)
--   20 篇共用同一个 R2 key: 省磁盘, 代码里也没有任何地方假设 key 唯一。
--
-- 清除: 见文件末尾的 "CLEANUP" 段, 把注释里的 DELETE 原样跑一遍即可 (按 id 前缀,
--   涵盖本脚本写过的全部四张表)。R2 占位对象另删, 命令也在那里。
--
-- 幂等性: 全部 INSERT OR REPLACE, 可反复执行 (重跑会把日期刷新到"相对现在"的窗口内,
--   免得 sort=popular 的滚动 30 天窗口把种子数据筛掉)。**papers 段必须排在最前**:
--   REPLACE 是 DELETE+INSERT, 开着外键时会级联删掉子表的行, 靠后面几段重新写回。
--   D1 不支持事务, 所以这里没有 BEGIN/COMMIT。
--
-- 数据里刻意埋的边界:
--   - seed-gallery-007 **没有** paper_results (验 tldr 缺失时卡片不塌);
--   - seed-gallery-005 的 tldr 特别长 (验 line-clamp);
--   - 001 / 004 / 009 / 013 / 018 归属 ai4formath, 其余 direction_id 为 NULL;
--   - published_at 互不相同且严格递减 (每篇差 8 小时), 好肉眼确认排序与分页边界;
--   - tldr / summaries 的 key 是**小写** en / zh-cn / zh-tw / ja (写成 zh-CN 会挑不出来),
--     四种语言内容真的不一样, 切语言时看得出有没有生效。
--   - pdf_r2_key 指向不存在的对象: 画廊卡片用不到它, 只有 PDF 阅读器会 404。

-- ---------------------------------------------------------------------------
-- 1) papers —— 必须最先执行 (见上文 REPLACE 级联说明)
-- ---------------------------------------------------------------------------
-- user_id / direction_id 用子查询而不是硬编码 id: 本地库之间的 user id 各不相同,
-- 硬编码会造出外键指不到人的孤儿行。
INSERT OR REPLACE INTO papers
  (id, short_id, user_id, title, source_type, source_url, pdf_r2_key, file_size,
   page_count, upvotes, direction_id, status, is_public, is_listed_in_gallery,
   published_at, created_at, updated_at)
VALUES
  ('seed-gallery-001', 'sgal001', (SELECT id FROM user ORDER BY id LIMIT 1),
   'Lean-Copilot: Retrieval-Augmented Premise Selection for Interactive Theorem Proving',
   'arxiv', 'https://arxiv.org/abs/2699.10001', 'papers/seed-gallery/seed-gallery-001.pdf', 812340,
   18, 214, (SELECT id FROM directions WHERE slug = 'ai4formath'), 'completed', 1, 1,
   strftime('%s','now') - 3600 * 8,   strftime('%s','now') - 3600 * 8,   strftime('%s','now') - 3600 * 8),
  ('seed-gallery-002', 'sgal002', (SELECT id FROM user ORDER BY id LIMIT 1),
   'Scaling Laws for Mixture-of-Experts Under Fixed Inference Budgets',
   'arxiv', 'https://arxiv.org/abs/2699.10002', 'papers/seed-gallery/seed-gallery-002.pdf', 1043117,
   24, 331, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 16,  strftime('%s','now') - 3600 * 16,  strftime('%s','now') - 3600 * 16),
  ('seed-gallery-003', 'sgal003', (SELECT id FROM user ORDER BY id LIMIT 1),
   'VideoWeaver: Long-Horizon Video Generation with Hierarchical Latent Planning',
   'arxiv', 'https://arxiv.org/abs/2699.10003', 'papers/seed-gallery/seed-gallery-003.pdf', 2214880,
   31, 288, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 24,  strftime('%s','now') - 3600 * 24,  strftime('%s','now') - 3600 * 24),
  ('seed-gallery-004', 'sgal004', (SELECT id FROM user ORDER BY id LIMIT 1),
   'Autoformalizing Undergraduate Analysis: A Benchmark and Baselines in Lean 4',
   'arxiv', 'https://arxiv.org/abs/2699.10004', 'papers/seed-gallery/seed-gallery-004.pdf', 743902,
   16, 176, (SELECT id FROM directions WHERE slug = 'ai4formath'), 'completed', 1, 1,
   strftime('%s','now') - 3600 * 32,  strftime('%s','now') - 3600 * 32,  strftime('%s','now') - 3600 * 32),
  ('seed-gallery-005', 'sgal005', (SELECT id FROM user ORDER BY id LIMIT 1),
   'SparseKV: Attention-Sink Aware KV Cache Eviction for Million-Token Contexts',
   'arxiv', 'https://arxiv.org/abs/2699.10005', 'papers/seed-gallery/seed-gallery-005.pdf', 968451,
   21, 402, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 40,  strftime('%s','now') - 3600 * 40,  strftime('%s','now') - 3600 * 40),
  ('seed-gallery-006', 'sgal006', (SELECT id FROM user ORDER BY id LIMIT 1),
   'Do Reward Models Generalize? Probing Preference Transfer Across Domains',
   'arxiv', 'https://arxiv.org/abs/2699.10006', 'papers/seed-gallery/seed-gallery-006.pdf', 654201,
   14, 129, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 48,  strftime('%s','now') - 3600 * 48,  strftime('%s','now') - 3600 * 48),
  -- 007 刻意不写 paper_results: 验证 tldr 缺失时卡片不塌
  ('seed-gallery-007', 'sgal007', (SELECT id FROM user ORDER BY id LIMIT 1),
   'TactileGrasp: Cross-Modal Pretraining for Dexterous Robotic Manipulation',
   'arxiv', 'https://arxiv.org/abs/2699.10007', 'papers/seed-gallery/seed-gallery-007.pdf', 1330074,
   27, 97, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 56,  strftime('%s','now') - 3600 * 56,  strftime('%s','now') - 3600 * 56),
  ('seed-gallery-008', 'sgal008', (SELECT id FROM user ORDER BY id LIMIT 1),
   'Chain-of-Thought Distillation Without Teacher Logits',
   'arxiv', 'https://arxiv.org/abs/2699.10008', 'papers/seed-gallery/seed-gallery-008.pdf', 512663,
   12, 245, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 64,  strftime('%s','now') - 3600 * 64,  strftime('%s','now') - 3600 * 64),
  ('seed-gallery-009', 'sgal009', (SELECT id FROM user ORDER BY id LIMIT 1),
   'ProofNet-XL: Neural Proof Search with Verified Subgoal Decomposition',
   'arxiv', 'https://arxiv.org/abs/2699.10009', 'papers/seed-gallery/seed-gallery-009.pdf', 887210,
   19, 163, (SELECT id FROM directions WHERE slug = 'ai4formath'), 'completed', 1, 1,
   strftime('%s','now') - 3600 * 72,  strftime('%s','now') - 3600 * 72,  strftime('%s','now') - 3600 * 72),
  ('seed-gallery-010', 'sgal010', (SELECT id FROM user ORDER BY id LIMIT 1),
   'RAG on Trial: Measuring Attribution Faithfulness in Retrieval-Augmented Generation',
   'arxiv', 'https://arxiv.org/abs/2699.10010', 'papers/seed-gallery/seed-gallery-010.pdf', 701558,
   15, 208, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 80,  strftime('%s','now') - 3600 * 80,  strftime('%s','now') - 3600 * 80),
  ('seed-gallery-011', 'sgal011', (SELECT id FROM user ORDER BY id LIMIT 1),
   'Whisper-Lite: 8-bit Streaming Speech Recognition on Edge Devices',
   'arxiv', 'https://arxiv.org/abs/2699.10011', 'papers/seed-gallery/seed-gallery-011.pdf', 447319,
   11, 84, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 88,  strftime('%s','now') - 3600 * 88,  strftime('%s','now') - 3600 * 88),
  ('seed-gallery-012', 'sgal012', (SELECT id FROM user ORDER BY id LIMIT 1),
   'Emergent Tool Use in Multi-Agent Web Navigation',
   'arxiv', 'https://arxiv.org/abs/2699.10012', 'papers/seed-gallery/seed-gallery-012.pdf', 936442,
   22, 191, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 96,  strftime('%s','now') - 3600 * 96,  strftime('%s','now') - 3600 * 96),
  ('seed-gallery-013', 'sgal013', (SELECT id FROM user ORDER BY id LIMIT 1),
   'Mathlib as a Corpus: Statistical Structure of Formalized Mathematics',
   'arxiv', 'https://arxiv.org/abs/2699.10013', 'papers/seed-gallery/seed-gallery-013.pdf', 623904,
   17, 142, (SELECT id FROM directions WHERE slug = 'ai4formath'), 'completed', 1, 1,
   strftime('%s','now') - 3600 * 104, strftime('%s','now') - 3600 * 104, strftime('%s','now') - 3600 * 104),
  ('seed-gallery-014', 'sgal014', (SELECT id FROM user ORDER BY id LIMIT 1),
   'Diffusion Guidance Without Classifier-Free Sampling',
   'arxiv', 'https://arxiv.org/abs/2699.10014', 'papers/seed-gallery/seed-gallery-014.pdf', 1187330,
   20, 267, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 112, strftime('%s','now') - 3600 * 112, strftime('%s','now') - 3600 * 112),
  ('seed-gallery-015', 'sgal015', (SELECT id FROM user ORDER BY id LIMIT 1),
   'Interpreting Refusal Directions in Instruction-Tuned Language Models',
   'arxiv', 'https://arxiv.org/abs/2699.10015', 'papers/seed-gallery/seed-gallery-015.pdf', 589112,
   13, 156, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 120, strftime('%s','now') - 3600 * 120, strftime('%s','now') - 3600 * 120),
  ('seed-gallery-016', 'sgal016', (SELECT id FROM user ORDER BY id LIMIT 1),
   'Long-Context Retrieval Heads Are Sparse and Transferable',
   'arxiv', 'https://arxiv.org/abs/2699.10016', 'papers/seed-gallery/seed-gallery-016.pdf', 674285,
   16, 178, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 128, strftime('%s','now') - 3600 * 128, strftime('%s','now') - 3600 * 128),
  ('seed-gallery-017', 'sgal017', (SELECT id FROM user ORDER BY id LIMIT 1),
   'PixelCritic: Reward Modeling for Text-to-Image Alignment from Human Sketches',
   'arxiv', 'https://arxiv.org/abs/2699.10017', 'papers/seed-gallery/seed-gallery-017.pdf', 1502771,
   25, 113, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 136, strftime('%s','now') - 3600 * 136, strftime('%s','now') - 3600 * 136),
  ('seed-gallery-018', 'sgal018', (SELECT id FROM user ORDER BY id LIMIT 1),
   'Formal Verification of Neural Network Controllers via Lean Tactics',
   'arxiv', 'https://arxiv.org/abs/2699.10018', 'papers/seed-gallery/seed-gallery-018.pdf', 795640,
   18, 121, (SELECT id FROM directions WHERE slug = 'ai4formath'), 'completed', 1, 1,
   strftime('%s','now') - 3600 * 144, strftime('%s','now') - 3600 * 144, strftime('%s','now') - 3600 * 144),
  ('seed-gallery-019', 'sgal019', (SELECT id FROM user ORDER BY id LIMIT 1),
   'Curriculum Data Mixing for Continual Pretraining of Small Language Models',
   'arxiv', 'https://arxiv.org/abs/2699.10019', 'papers/seed-gallery/seed-gallery-019.pdf', 838219,
   19, 149, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 152, strftime('%s','now') - 3600 * 152, strftime('%s','now') - 3600 * 152),
  ('seed-gallery-020', 'sgal020', (SELECT id FROM user ORDER BY id LIMIT 1),
   'BenchRot: Detecting Contamination in Public Reasoning Benchmarks',
   'arxiv', 'https://arxiv.org/abs/2699.10020', 'papers/seed-gallery/seed-gallery-020.pdf', 566903,
   14, 95, NULL, 'completed', 1, 1,
   strftime('%s','now') - 3600 * 160, strftime('%s','now') - 3600 * 160, strftime('%s','now') - 3600 * 160);

-- ---------------------------------------------------------------------------
-- 2) whiteboard_images —— is_default=1 是卡片出现的硬条件 (listPublic 的 innerJoin)
-- ---------------------------------------------------------------------------
-- 20 篇共用同一个 R2 key, 见文件头的 `wrangler r2 object put` 命令。
INSERT OR REPLACE INTO whiteboard_images (id, paper_id, image_r2_key, is_default, created_at)
VALUES
  ('seed-gallery-wb-001', 'seed-gallery-001', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-002', 'seed-gallery-002', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-003', 'seed-gallery-003', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-004', 'seed-gallery-004', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-005', 'seed-gallery-005', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-006', 'seed-gallery-006', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-007', 'seed-gallery-007', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-008', 'seed-gallery-008', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-009', 'seed-gallery-009', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-010', 'seed-gallery-010', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-011', 'seed-gallery-011', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-012', 'seed-gallery-012', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-013', 'seed-gallery-013', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-014', 'seed-gallery-014', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-015', 'seed-gallery-015', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-016', 'seed-gallery-016', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-017', 'seed-gallery-017', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-018', 'seed-gallery-018', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-019', 'seed-gallery-019', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now')),
  ('seed-gallery-wb-020', 'seed-gallery-020', 'whiteboards/seed-gallery/placeholder.webp', 1, strftime('%s','now'));

-- ---------------------------------------------------------------------------
-- 3) paper_results —— tldr / summaries 是四语 JSON, key 小写 en / zh-cn / zh-tw / ja
-- ---------------------------------------------------------------------------
-- categories 取 src/lib/paper-categories.ts 的固定 slug 集合; tags 一律小写连字符。
-- 注意 007 不在下面 —— 那是刻意留的"无 tldr"样本。
INSERT OR REPLACE INTO paper_results
  (id, paper_id, summaries, tldr, categories, tags, summary_language, created_at)
VALUES
  ('seed-gallery-res-001', 'seed-gallery-001',
   '{"en":"A retrieval layer over Mathlib lets the prover pick premises that matter, lifting proof success on miniF2F.","zh-cn":"在 Mathlib 上加一层检索，让证明器挑得准前提，miniF2F 成功率随之提升。","zh-tw":"在 Mathlib 上加一層檢索，讓證明器挑得準前提，miniF2F 成功率隨之提升。","ja":"Mathlib 上に検索層を置き、前提選択の精度を上げて miniF2F の成功率を改善した。"}',
   '{"en":"Retrieval-augmented premise selection raises Lean 4 proof success by 11 points.","zh-cn":"检索增强的前提选择让 Lean 4 证明成功率提高 11 个点。","zh-tw":"檢索增強的前提選擇讓 Lean 4 證明成功率提高 11 個百分點。","ja":"検索拡張による前提選択で Lean 4 の証明成功率が 11 ポイント向上。"}',
   '["reasoning-planning","ai-for-science"]', '["theorem-proving","lean4","premise-selection","retrieval"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-002', 'seed-gallery-002',
   '{"en":"Expert count trades off against active parameters in a predictable way once inference cost is held fixed.","zh-cn":"固定推理预算后，专家数量与激活参数之间存在可预测的取舍关系。","zh-tw":"固定推理預算後，專家數量與啟用參數之間存在可預測的取捨關係。","ja":"推論コストを固定すると、エキスパート数と活性パラメータの間に予測可能なトレードオフが現れる。"}',
   '{"en":"Fixing the inference budget yields a clean scaling law for MoE expert count.","zh-cn":"固定推理预算后，MoE 专家数量呈现出干净的缩放律。","zh-tw":"固定推論預算後，MoE 專家數量呈現出乾淨的縮放律。","ja":"推論予算を固定すると MoE のエキスパート数に明快なスケーリング則が現れる。"}',
   '["llm","efficiency","ml-theory"]', '["mixture-of-experts","scaling-laws","inference-cost"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-003', 'seed-gallery-003',
   '{"en":"A two-stage latent planner keeps minute-long videos coherent without per-frame conditioning.","zh-cn":"两段式潜在规划器让分钟级视频保持连贯，且无需逐帧条件控制。","zh-tw":"兩段式潛在規劃器讓分鐘級影片保持連貫，且無需逐幀條件控制。","ja":"二段階の潜在プランナーにより、フレームごとの条件付けなしで分単位の動画が一貫性を保つ。"}',
   '{"en":"Hierarchical latent planning keeps minute-long generated video coherent.","zh-cn":"分层潜在规划让分钟级生成视频保持连贯。","zh-tw":"分層潛在規劃讓分鐘級生成影片保持連貫。","ja":"階層的潜在プランニングで分単位の生成動画の一貫性を維持。"}',
   '["generative","vision","multimodal"]', '["video-generation","latent-planning","diffusion"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-004', 'seed-gallery-004',
   '{"en":"A 3.2k-problem analysis benchmark in Lean 4, with baselines showing autoformalization is still far from solved.","zh-cn":"一个含 3200 道分析题的 Lean 4 基准，基线结果表明自动形式化远未解决。","zh-tw":"一個含 3200 道分析題的 Lean 4 基準，基線結果表明自動形式化遠未解決。","ja":"Lean 4 による 3200 問の解析学ベンチマーク。ベースライン結果は自動形式化がまだ遠いことを示す。"}',
   '{"en":"New Lean 4 benchmark shows autoformalization tops out near 22 percent.","zh-cn":"新的 Lean 4 基准显示自动形式化上限约为 22%。","zh-tw":"新的 Lean 4 基準顯示自動形式化上限約為 22%。","ja":"新しい Lean 4 ベンチマークで自動形式化の上限は約 22% と判明。"}',
   '["data-benchmark","ai-for-science","reasoning-planning"]', '["autoformalization","lean4","benchmark","real-analysis"]',
   'en', strftime('%s','now')),
  -- 005 的 tldr 刻意写得很长: 验证卡片摘要的 line-clamp 截断
  ('seed-gallery-res-005', 'seed-gallery-005',
   '{"en":"Eviction guided by attention sinks preserves the tokens that later queries actually attend to.","zh-cn":"以注意力汇聚点为指引的淘汰策略，保住了后续查询真正会关注的 token。","zh-tw":"以注意力匯聚點為指引的淘汰策略，保住了後續查詢真正會關注的 token。","ja":"アテンションシンクに導かれた退避により、後続クエリが実際に参照するトークンを温存する。"}',
   '{"en":"We show that the usual recency heuristic for KV cache eviction throws away precisely the tokens that later queries come back to, and that a small number of attention-sink positions can be identified cheaply at prefill time and pinned in cache; keeping those pinned entries while evicting aggressively everywhere else recovers 97 percent of full-cache quality on million-token retrieval workloads at roughly one fifth of the memory, with no retraining, no auxiliary model, and a drop-in change to the serving stack that adds under two percent latency overhead.","zh-cn":"我们发现 KV 缓存淘汰常用的近因启发式恰好丢掉了后续查询会回头访问的 token；而少量注意力汇聚位置可以在 prefill 阶段被廉价识别并钉在缓存里。钉住这部分、其余位置激进淘汰，可在百万 token 检索负载上以约五分之一的显存恢复全缓存 97% 的质量，无需重训练、无需辅助模型，只是服务栈上的一处直接替换，额外延迟低于 2%。","zh-tw":"我們發現 KV 快取淘汰常用的近因啟發式恰好丟掉了後續查詢會回頭存取的 token；而少量注意力匯聚位置可以在 prefill 階段被廉價識別並釘在快取裡。釘住這部分、其餘位置激進淘汰，可在百萬 token 檢索負載上以約五分之一的顯存恢復全快取 97% 的品質，無需重訓練、無需輔助模型，只是服務堆疊上的一處直接替換，額外延遲低於 2%。","ja":"KV キャッシュ退避で一般的な直近性ヒューリスティックは、後続クエリが戻って参照するトークンをまさに捨ててしまう。少数のアテンションシンク位置は prefill 時に安価に特定でき、キャッシュに固定できる。それらを固定したうえで他を積極的に退避すると、百万トークン級の検索ワークロードで約五分の一のメモリのままフルキャッシュ品質の 97% を回復し、再学習も補助モデルも不要、サービング層への差し替えのみで追加レイテンシは 2% 未満に収まる。"}',
   '["efficiency","llm"]', '["kv-cache","long-context","attention-sink","inference"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-006', 'seed-gallery-006',
   '{"en":"Reward models transfer poorly across domains; most of the apparent gain is style, not correctness.","zh-cn":"奖励模型跨领域迁移很差，看起来的增益大多来自文风而非正确性。","zh-tw":"獎勵模型跨領域遷移很差，看起來的增益大多來自文風而非正確性。","ja":"報酬モデルの領域間転移は弱く、見かけの向上の大半は正しさではなく文体に由来する。"}',
   '{"en":"Reward models mostly transfer style, not correctness, across domains.","zh-cn":"奖励模型跨领域迁移的主要是文风，而非正确性。","zh-tw":"獎勵模型跨領域遷移的主要是文風，而非正確性。","ja":"報酬モデルが領域を越えて転移するのは主に文体であり正しさではない。"}',
   '["alignment-safety","llm"]', '["reward-model","preference-learning","generalization"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-008', 'seed-gallery-008',
   '{"en":"Distilling reasoning traces works from sampled text alone, removing the need for teacher logit access.","zh-cn":"仅凭采样文本即可蒸馏推理轨迹，无需访问教师模型的 logits。","zh-tw":"僅憑取樣文本即可蒸餾推理軌跡，無需存取教師模型的 logits。","ja":"サンプリングしたテキストだけで推論過程を蒸留でき、教師モデルの logits へのアクセスが不要になる。"}',
   '{"en":"Reasoning distillation works from sampled text, no teacher logits needed.","zh-cn":"推理蒸馏只用采样文本即可，无需教师 logits。","zh-tw":"推理蒸餾只用取樣文本即可，無需教師 logits。","ja":"推論の蒸留はサンプルテキストのみで可能、教師 logits は不要。"}',
   '["llm","reasoning-planning","efficiency"]', '["distillation","chain-of-thought","black-box"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-009', 'seed-gallery-009',
   '{"en":"Decomposing goals into machine-checked subgoals keeps proof search from drifting into dead branches.","zh-cn":"把目标拆成可机器校验的子目标，能防止证明搜索漂进死枝。","zh-tw":"把目標拆成可機器校驗的子目標，能防止證明搜尋漂進死枝。","ja":"目標を機械検証可能なサブゴールに分解することで、証明探索が行き止まりに逸れるのを防ぐ。"}',
   '{"en":"Verified subgoal decomposition cuts wasted proof search by half.","zh-cn":"经校验的子目标分解让无效证明搜索减少一半。","zh-tw":"經校驗的子目標分解讓無效證明搜尋減少一半。","ja":"検証済みサブゴール分解で無駄な証明探索が半減。"}',
   '["reasoning-planning","ai-for-science"]', '["proof-search","theorem-proving","subgoals","lean4"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-010', 'seed-gallery-010',
   '{"en":"Citations in RAG answers are frequently unsupported even when the final answer is correct.","zh-cn":"RAG 答案里的引用常常缺乏支撑，哪怕最终答案是对的。","zh-tw":"RAG 答案裡的引用常常缺乏支撐，哪怕最終答案是對的。","ja":"RAG の回答に付く引用は、最終的な答えが正しくても裏付けを欠くことが多い。"}',
   '{"en":"Correct RAG answers still cite unsupported passages 38 percent of the time.","zh-cn":"即便答案正确，RAG 仍有 38% 的引用缺乏原文支撑。","zh-tw":"即便答案正確，RAG 仍有 38% 的引用缺乏原文支撐。","ja":"正解時でも RAG の引用の 38% は根拠がない。"}',
   '["retrieval-rag","nlp"]', '["rag","attribution","faithfulness","evaluation"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-011', 'seed-gallery-011',
   '{"en":"Post-training quantization plus a streaming decoder puts real-time ASR inside a phone-class budget.","zh-cn":"训练后量化配合流式解码器，让实时语音识别塞进手机级算力预算。","zh-tw":"訓練後量化配合串流解碼器，讓即時語音辨識塞進手機級算力預算。","ja":"学習後量子化とストリーミングデコーダにより、リアルタイム音声認識をスマホ級の予算に収める。"}',
   '{"en":"8-bit streaming ASR runs in real time on phone-class hardware.","zh-cn":"8 比特流式语音识别可在手机级硬件上实时运行。","zh-tw":"8 位元串流語音辨識可在手機級硬體上即時執行。","ja":"8 ビットのストリーミング ASR がスマホ級ハードで実時間動作。"}',
   '["speech-audio","efficiency"]', '["asr","quantization","streaming","on-device"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-012', 'seed-gallery-012',
   '{"en":"Agents left to coordinate on shared web tasks invent reusable tools without being told to.","zh-cn":"让多个智能体在共享网页任务上协作，它们会自发发明可复用的工具。","zh-tw":"讓多個智慧體在共享網頁任務上協作，它們會自發發明可重複使用的工具。","ja":"共有ウェブタスクで協調させると、エージェントは指示なしに再利用可能なツールを生み出す。"}',
   '{"en":"Multi-agent web navigation produces reusable tools with no explicit incentive.","zh-cn":"多智能体网页导航在没有显式激励下产生了可复用工具。","zh-tw":"多智慧體網頁導航在沒有顯式激勵下產生了可重複使用的工具。","ja":"明示的な報酬なしにマルチエージェントのウェブ操作が再利用可能なツールを生成。"}',
   '["agents","reinforcement-learning"]', '["multi-agent","tool-use","web-agents","emergence"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-013', 'seed-gallery-013',
   '{"en":"Treating Mathlib as a text corpus reveals heavy-tailed lemma reuse and shallow proof depth.","zh-cn":"把 Mathlib 当作文本语料来看，可以发现引理复用呈重尾分布、证明深度偏浅。","zh-tw":"把 Mathlib 當作文本語料來看，可以發現引理複用呈重尾分布、證明深度偏淺。","ja":"Mathlib をテキストコーパスとして扱うと、補題再利用の重い裾と証明深度の浅さが見えてくる。"}',
   '{"en":"Lemma reuse in Mathlib is heavy-tailed; median proof depth is only four.","zh-cn":"Mathlib 的引理复用呈重尾分布，证明深度中位数只有 4。","zh-tw":"Mathlib 的引理複用呈重尾分布，證明深度中位數只有 4。","ja":"Mathlib の補題再利用は重い裾を持ち、証明深度の中央値はわずか 4。"}',
   '["ai-for-science","data-benchmark"]', '["mathlib","corpus-analysis","formal-math"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-014', 'seed-gallery-014',
   '{"en":"A learned guidance field matches CFG quality at a single forward pass per step.","zh-cn":"一个学习得到的引导场，用每步单次前向就达到了 CFG 的质量。","zh-tw":"一個學習得到的引導場，用每步單次前向就達到了 CFG 的品質。","ja":"学習されたガイダンス場により、ステップあたり 1 回の順伝播で CFG 相当の品質を達成。"}',
   '{"en":"A learned guidance field matches classifier-free quality at half the compute.","zh-cn":"学习式引导场以一半算力达到无分类器引导的质量。","zh-tw":"學習式引導場以一半算力達到無分類器引導的品質。","ja":"学習型ガイダンス場が半分の計算量で classifier-free 相当の品質に到達。"}',
   '["generative","efficiency"]', '["diffusion","guidance","sampling"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-015', 'seed-gallery-015',
   '{"en":"Refusal behaviour concentrates in a low-rank direction that survives fine-tuning.","zh-cn":"拒答行为集中在一个低秩方向上，且在微调后依然存在。","zh-tw":"拒答行為集中在一個低秩方向上，且在微調後依然存在。","ja":"拒否挙動は低ランクな方向に集中しており、ファインチューニング後も残存する。"}',
   '{"en":"Refusal lives in a low-rank direction that survives fine-tuning.","zh-cn":"拒答行为存在于一个低秩方向中，微调也抹不掉。","zh-tw":"拒答行為存在於一個低秩方向中，微調也抹不掉。","ja":"拒否は低ランク方向に宿り、ファインチューニングでも消えない。"}',
   '["alignment-safety","llm"]', '["interpretability","refusal","activation-steering"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-016', 'seed-gallery-016',
   '{"en":"A handful of heads carry nearly all long-range retrieval, and they transfer across model families.","zh-cn":"少数几个注意力头承担了几乎全部长程检索，而且能跨模型族迁移。","zh-tw":"少數幾個注意力頭承擔了幾乎全部長程檢索，而且能跨模型族遷移。","ja":"ごく少数のヘッドが長距離検索のほぼすべてを担い、モデル系列を越えて転移する。"}',
   '{"en":"Fewer than 20 heads carry nearly all long-range retrieval behaviour.","zh-cn":"不到 20 个注意力头承载了几乎全部长程检索行为。","zh-tw":"不到 20 個注意力頭承載了幾乎全部長程檢索行為。","ja":"20 未満のヘッドが長距離検索の挙動をほぼ全て担う。"}',
   '["llm","ml-theory"]', '["long-context","attention-heads","interpretability"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-017', 'seed-gallery-017',
   '{"en":"Rough human sketches turn out to be a cheaper and more reliable reward signal than pairwise ranking.","zh-cn":"粗糙的人类草图作为奖励信号，比成对排序更便宜也更可靠。","zh-tw":"粗糙的人類草圖作為獎勵訊號，比成對排序更便宜也更可靠。","ja":"粗い人手スケッチは、ペアワイズ順位付けより安価で信頼できる報酬信号となる。"}',
   '{"en":"Human sketches beat pairwise ranking as a text-to-image reward signal.","zh-cn":"作为文生图奖励信号，人类草图胜过成对排序。","zh-tw":"作為文生圖獎勵訊號，人類草圖勝過成對排序。","ja":"テキスト画像生成の報酬信号として、人手スケッチがペア比較を上回る。"}',
   '["generative","multimodal","alignment-safety"]', '["text-to-image","reward-model","human-feedback"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-018', 'seed-gallery-018',
   '{"en":"Controller safety envelopes are discharged as Lean obligations, giving machine-checked guarantees.","zh-cn":"把控制器的安全包络转成 Lean 证明义务，从而获得机器校验的保证。","zh-tw":"把控制器的安全包絡轉成 Lean 證明義務，從而獲得機器校驗的保證。","ja":"制御器の安全包絡を Lean の証明義務として消化し、機械検証済みの保証を得る。"}',
   '{"en":"Neural controller safety envelopes get machine-checked proofs in Lean.","zh-cn":"神经控制器的安全包络在 Lean 中获得机器校验的证明。","zh-tw":"神經控制器的安全包絡在 Lean 中獲得機器校驗的證明。","ja":"ニューラル制御器の安全包絡に Lean で機械検証済みの証明を付与。"}',
   '["ai-for-science","robotics-3d","ml-theory"]', '["formal-verification","lean4","control","safety"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-019', 'seed-gallery-019',
   '{"en":"Ordering domains from general to specific beats uniform mixing at every model scale tested.","zh-cn":"把领域按从泛到专排序，在测试过的每个模型规模上都胜过均匀混合。","zh-tw":"把領域按從泛到專排序，在測試過的每個模型規模上都勝過均勻混合。","ja":"ドメインを汎用から専門へ順に並べる方式が、試したすべてのモデル規模で均一混合を上回った。"}',
   '{"en":"General-to-specific data ordering beats uniform mixing at every scale.","zh-cn":"从泛到专的数据排序在每个规模上都优于均匀混合。","zh-tw":"從泛到專的資料排序在每個規模上都優於均勻混合。","ja":"汎用から専門へのデータ順序付けが全規模で均一混合に勝る。"}',
   '["llm","data-benchmark"]', '["continual-pretraining","data-mixing","curriculum"]',
   'en', strftime('%s','now')),
  ('seed-gallery-res-020', 'seed-gallery-020',
   '{"en":"A perplexity-gap test flags contaminated items without needing access to the training corpus.","zh-cn":"一个困惑度差值检验可以在不接触训练语料的情况下标出被污染的题目。","zh-tw":"一個困惑度差值檢驗可以在不接觸訓練語料的情況下標出被污染的題目。","ja":"パープレキシティ差分検定により、学習コーパスにアクセスせず汚染項目を検出できる。"}',
   '{"en":"A perplexity-gap test finds benchmark contamination without corpus access.","zh-cn":"困惑度差值检验无需训练语料即可发现基准污染。","zh-tw":"困惑度差值檢驗無需訓練語料即可發現基準污染。","ja":"パープレキシティ差分検定でコーパス非公開でもベンチ汚染を検出。"}',
   '["data-benchmark","reasoning-planning"]', '["contamination","evaluation","benchmark"]',
   'en', strftime('%s','now'));

-- ---------------------------------------------------------------------------
-- 4) paper_feedback —— 让卡片底行的赞数不是 0 (likeCountSql 从这里数)
-- ---------------------------------------------------------------------------
-- 用 INSERT...SELECT 而不是 VALUES: user 表为空时自然插 0 行, 不会因为
-- 子查询返回 NULL 撞上 NOT NULL 约束。id 里拼上 user id 保证唯一,
-- 同时满足 (paper_id, user_id) 的唯一索引。
INSERT OR REPLACE INTO paper_feedback (id, paper_id, user_id, vote, created_at, updated_at)
SELECT 'seed-gallery-fb-001-' || u.id, 'seed-gallery-001', u.id, 1,
       strftime('%s','now'), strftime('%s','now')
FROM (SELECT id FROM user ORDER BY id LIMIT 2) u;

INSERT OR REPLACE INTO paper_feedback (id, paper_id, user_id, vote, created_at, updated_at)
SELECT 'seed-gallery-fb-004-' || u.id, 'seed-gallery-004', u.id, 1,
       strftime('%s','now'), strftime('%s','now')
FROM (SELECT id FROM user ORDER BY id LIMIT 2) u;

INSERT OR REPLACE INTO paper_feedback (id, paper_id, user_id, vote, created_at, updated_at)
SELECT 'seed-gallery-fb-009-' || u.id, 'seed-gallery-009', u.id, 1,
       strftime('%s','now'), strftime('%s','now')
FROM (SELECT id FROM user ORDER BY id LIMIT 1) u;

INSERT OR REPLACE INTO paper_feedback (id, paper_id, user_id, vote, created_at, updated_at)
SELECT 'seed-gallery-fb-013-' || u.id, 'seed-gallery-013', u.id, 1,
       strftime('%s','now'), strftime('%s','now')
FROM (SELECT id FROM user ORDER BY id LIMIT 1) u;

-- ---------------------------------------------------------------------------
-- CLEANUP —— 把下面四条 DELETE 原样跑一遍即可完全清除本脚本写入的数据
-- ---------------------------------------------------------------------------
-- mac npx wrangler d1 execute picx-db --local --persist-to=.wrangler/state --command "
--   DELETE FROM paper_feedback   WHERE id LIKE 'seed-gallery-fb-%';
--   DELETE FROM paper_results    WHERE id LIKE 'seed-gallery-res-%';
--   DELETE FROM whiteboard_images WHERE id LIKE 'seed-gallery-wb-%';
--   DELETE FROM papers           WHERE id LIKE 'seed-gallery-0%';
-- "
-- 子表先删是为了不依赖外键级联是否开启; papers 用 'seed-gallery-0%' 而不是
-- 'seed-gallery-%', 避免语义上跟子表的 id 前缀混在一起 (papers 的 id 一律是
-- seed-gallery-001 .. seed-gallery-020)。
--
-- 顺带删掉占位图片对象 (可选, 不删也无害):
--   mac npx wrangler r2 object delete \
--     "picx-papers-apac-preview/whiteboards/seed-gallery/placeholder.webp" \
--     --local --persist-to=.wrangler/state
