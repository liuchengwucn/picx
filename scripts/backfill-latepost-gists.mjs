#!/usr/bin/env node
/**
 * Backfill `gist` for existing LatePost (src-latepost) news_items, then mark
 * their stories dirty so the next news-cron round regenerates title/summary
 * with the TOPIC anchor.
 *
 * Why: LatePost long-form pieces open with lengthy scene-setting that often
 * recaps OTHER recent events; the stored excerpt (first 1000 chars) can miss
 * the article's own subject entirely, so summaries reported the background as
 * the news (see docs/superpowers/specs/2026-08-10-news-item-gist-design.md,
 * production case vUx735). Deploy the gist pipeline FIRST, then run this
 * script, so re-summarization sees the TOPIC line.
 *
 * Strategy:
 *   - target rows: source_id = 'src-latepost' AND gist IS NULL AND
 *     status != 'rejected' (rejected items feed nothing downstream)
 *   - run the new scoreRelevance (score + gist) in batches of 25; ONLY the
 *     gist is written — existing relevance_score/status stay untouched
 *   - stories owning clustered items get dirty = 1 (IN lists of 20 — D1
 *     binds at most 100 params per query)
 *
 * Safety:
 *   - Idempotent & resumable: only touches rows where gist IS NULL.
 *   - `--dry-run` calls no LLM and prints the target set.
 *
 * Usage (run via the host; needs env-var proxy support for node fetch):
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/backfill-latepost-gists.mjs
 *     [--dry-run] [--limit N]
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreRelevance } from "../src/lib/news/ai.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// ---------- args ----------
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 0; // 0 = no limit
if (limitIdx >= 0 && (!Number.isInteger(LIMIT) || LIMIT <= 0)) {
  // Number(undefined)/Number('ten') = NaN 会静默变成「无限制」，谨慎的试跑反而全量执行
  console.error("[backfill] --limit requires a positive integer");
  process.exit(1);
}

// ---------- env (.dev.vars) ----------
function loadDevVars() {
  const raw = readFileSync(join(projectRoot, ".dev.vars"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[m[1]] = val;
  }
  return env;
}

const E = loadDevVars();
const ACCOUNT_ID = E.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = E.CLOUDFLARE_API_TOKEN;
const DB_ID = E.CLOUDFLARE_D1_DATABASE_ID;
if (!ACCOUNT_ID || !API_TOKEN || !DB_ID) {
  console.error(
    "[backfill] missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / CLOUDFLARE_D1_DATABASE_ID in .dev.vars",
  );
  process.exit(1);
}
const AI_CONFIG = {
  openaiApiKey: E.OPENAI_API_KEY,
  openaiBaseUrl: E.OPENAI_BASE_URL,
  openaiModel: E.NEWS_OPENAI_MODEL || E.OPENAI_MODEL,
  geminiApiKey: E.GEMINI_API_KEY ?? "",
  cfApiToken: E.CF_API_TOKEN,
};
if (!AI_CONFIG.openaiApiKey) {
  console.error("[backfill] missing OPENAI_API_KEY in .dev.vars");
  process.exit(1);
}

// ---------- D1 access ----------
async function d1(sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data.errors ?? data)}`);
  }
  return data.result[0]?.results ?? [];
}

// ---------- main ----------
const rows = await d1(
  `SELECT id, title, excerpt, status, story_id FROM news_items
   WHERE source_id = 'src-latepost' AND gist IS NULL AND status != 'rejected'
   ORDER BY published_at DESC${LIMIT > 0 ? ` LIMIT ${LIMIT}` : ""}`,
);
console.log(`[backfill] ${rows.length} latepost items without gist`);
if (DRY_RUN) {
  for (const row of rows) console.log(`  [${row.status}] ${row.title}`);
  process.exit(0);
}

let ok = 0;
let failed = 0;
let dirtied = 0;
const BATCH = 25; // 与 filterStage 的 FILTER_BATCH_SIZE 一致
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  try {
    const results = await scoreRelevance(
      batch.map((row) => ({ title: row.title, excerpt: row.excerpt })),
      AI_CONFIG,
    );
    // dirty 标记先于 gist 写入（每批 ≤25 个 id，低于 D1 100 参数上限）：
    // 中途崩溃的最坏情况是 story 被多重摘要一次（幂等无害）。反过来（先写 gist
    // 后标 dirty）崩溃时，重跑因 gist IS NULL 幂等选取跳过已写条目，story 永不重摘要
    const storyIds = [
      ...new Set(
        batch
          .filter(
            (row, j) =>
              results[j].gist && row.status === "clustered" && row.story_id,
          )
          .map((row) => row.story_id),
      ),
    ];
    if (storyIds.length > 0) {
      await d1(
        `UPDATE news_stories SET dirty = 1 WHERE id IN (${storyIds.map(() => "?").join(",")})`,
        storyIds,
      );
      dirtied += storyIds.length;
    }
    for (let j = 0; j < batch.length; j++) {
      const gist = results[j].gist;
      if (!gist) {
        console.log(`  no gist: ${batch[j].title.slice(0, 60)}`);
        failed++;
        continue;
      }
      // 只写 gist：既有 relevance_score/status 是旧 prompt 的产物但已消费过，
      // 重写会把已聚类条目搅乱（如改判 rejected），不做
      await d1(`UPDATE news_items SET gist = ? WHERE id = ?`, [
        gist,
        batch[j].id,
      ]);
      console.log(`  ${batch[j].title.slice(0, 40)} → ${gist.slice(0, 80)}`);
      ok++;
    }
  } catch (error) {
    console.error(
      `[backfill] batch at offset ${i} failed:`,
      String(error).slice(0, 200),
    );
    failed += batch.length;
  }
}

console.log(
  `[backfill] done: ${ok} gists written, ${failed} failed, ${dirtied} story marks (re-summarized by next cron round)`,
);
