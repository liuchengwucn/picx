#!/usr/bin/env node
/**
 * Backfill `excerpt` for existing news_items rows that were ingested without
 * body text (HN / some blog feeds carry no content), then mark the affected
 * stories dirty so the next news-cron round regenerates their title/summary/
 * key_facts with the new anti-hallucination prompt.
 *
 * Why: with excerpt = NULL the summarize LLM only sees a headline and fills
 * the gap from stale training knowledge — several published stories reported
 * months-old events as news (see docs/superpowers/specs/
 * 2026-08-10-news-excerpt-enrichment-design.md). Deploy the enrich pipeline
 * FIRST, then run this script, so re-summarization uses the new prompt
 * (summarizeStage picks up dirty archived stories too).
 *
 * Strategy:
 *   - target rows: excerpt IS NULL AND status != 'rejected', excluding
 *     news.ycombinator.com discussion pages (they render as nav + comments,
 *     not article text — same exclusion as enrichStage)
 *   - fetch readable body via Jina Reader (shared fetchReadable from
 *     src/lib/news/enrich.ts), paced under the free 20 RPM tier (3.5s between
 *     requests); JINA_API_KEY in .dev.vars is used if present
 *   - on success UPDATE news_items.excerpt; failures are logged and skipped;
 *     HTTP 429 aborts the run (progress is kept — the script is resumable)
 *   - stories owning successfully-enriched clustered items get dirty = 1
 *     (batched IN lists of 20 — D1 binds at most 100 params per query)
 *
 * Safety:
 *   - Idempotent & resumable: only touches rows where excerpt IS NULL.
 *   - `--dry-run` fetches nothing and prints the target set.
 *
 * Usage (run via the host; needs env-var proxy support for node fetch):
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/backfill-news-excerpts.mjs
 *     [--dry-run] [--limit N]
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EnrichRateLimitError, fetchReadable } from "../src/lib/news/enrich.ts";

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
const JINA_API_KEY = E.JINA_API_KEY || undefined;
if (!ACCOUNT_ID || !API_TOKEN || !DB_ID) {
  console.error(
    "[backfill] missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / CLOUDFLARE_D1_DATABASE_ID in .dev.vars",
  );
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- main ----------
const rows = await d1(
  `SELECT id, url, status, story_id FROM news_items
   WHERE (excerpt IS NULL OR excerpt = '') AND status != 'rejected'
     AND url NOT LIKE 'https://news.ycombinator.com/%'
   ORDER BY published_at DESC${LIMIT > 0 ? ` LIMIT ${LIMIT}` : ""}`,
);
console.log(`[backfill] ${rows.length} items without excerpt`);
if (DRY_RUN) {
  for (const row of rows) console.log(`  [${row.status}] ${row.url}`);
  process.exit(0);
}

let ok = 0;
let failed = 0;
let aborted = false;
const dirtyStoryIds = new Set();
for (const [i, row] of rows.entries()) {
  console.log(`[${i + 1}/${rows.length}] ${row.url.slice(0, 100)}`);
  try {
    const content = await fetchReadable(row.url, JINA_API_KEY);
    if (content) {
      await d1(`UPDATE news_items SET excerpt = ? WHERE id = ?`, [
        content,
        row.id,
      ]);
      if (row.status === "clustered" && row.story_id) {
        dirtyStoryIds.add(row.story_id);
      }
      ok++;
    } else {
      failed++;
    }
  } catch (error) {
    if (error instanceof EnrichRateLimitError) {
      // 限流窗口内继续打只会把剩余目标全烧成 failed；带着已完成进度收工，稍后重跑续上
      console.error("[backfill] rate limited (429), aborting — rerun later");
      aborted = true;
      break;
    }
    console.error("  failed:", String(error).slice(0, 200));
    failed++;
  }
  // 匿名档 20 RPM；即便配了 key 也不抢，回填不赶时间
  if (i < rows.length - 1) await sleep(3500);
}

const storyIds = [...dirtyStoryIds];
for (let i = 0; i < storyIds.length; i += 20) {
  const batch = storyIds.slice(i, i + 20);
  await d1(
    `UPDATE news_stories SET dirty = 1 WHERE id IN (${batch.map(() => "?").join(",")})`,
    batch,
  );
}
console.log(
  `[backfill] ${aborted ? "aborted" : "done"}: ${ok} enriched, ${failed} failed, ${storyIds.length} stories marked dirty (re-summarized by next cron round)`,
);
