#!/usr/bin/env node
/**
 * Backfill `upvotes` for existing arXiv papers from the HuggingFace paper API.
 *
 * `upvotes` is normally written by arxiv-cron for freshly-fetched HF daily
 * papers. Historical papers (ingested before upvotes were captured) have NULL,
 * which makes the gallery "most upvoted" (last-30-days) sort meaningless. This
 * script fills them in from `https://huggingface.co/api/papers/{arxivId}`.
 *
 * Scope: by default only arXiv papers published in the last 30 days (the only
 * ones the popular sort can surface). Pass --all to backfill every arXiv paper
 * with NULL upvotes regardless of age.
 *
 * Safety:
 *   - Idempotent & resumable: only touches rows where `upvotes IS NULL`.
 *   - Per-paper try/catch: a paper not on HF (404) or any error is skipped
 *     (left NULL), never aborts the batch.
 *   - `--dry-run` prints what would be written without modifying the DB.
 *
 * HF API requires outbound internet; when run behind a proxy set
 * NODE_USE_ENV_PROXY=1 + HTTPS_PROXY (the Cloudflare D1 REST calls go through
 * the same fetch and tolerate the proxy).
 *
 * Usage (run on the host so .dev.vars + network are available):
 *   node scripts/backfill-upvotes.mjs [--dry-run] [--all]
 *        [--since-days N] [--limit N] [--batch N] [--concurrency N]
 *   Defaults: last 30 days, batch 20, concurrency 4, no limit.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getOpt = (f, def) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DRY_RUN = hasFlag("--dry-run");
const ALL = hasFlag("--all");
const SINCE_DAYS = Math.max(1, Number(getOpt("--since-days", "30")));
const LIMIT = Number(getOpt("--limit", "0"));
const BATCH = Math.max(1, Number(getOpt("--batch", "20")));
const CONCURRENCY = Math.max(1, Number(getOpt("--concurrency", "4")));

function loadDevVars() {
  const raw = readFileSync(join(projectRoot, ".dev.vars"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const E = loadDevVars();
const ACCOUNT_ID = E.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = E.CLOUDFLARE_API_TOKEN;
const DB_ID = E.CLOUDFLARE_D1_DATABASE_ID;

async function d1Remote(sql, params = []) {
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
  const json = await res.json();
  if (!json.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(json.errors)}`);
  }
  return json.result[0].results;
}

// "https://arxiv.org/abs/2605.00658v2" -> "2605.00658"
function arxivId(sourceUrl) {
  if (!sourceUrl) return null;
  const m = sourceUrl.match(/abs\/(.+?)(v\d+)?$/);
  return m ? m[1] : null;
}

async function fetchUpvotes(id) {
  const res = await fetch(`https://huggingface.co/api/papers/${id}`);
  if (res.status === 404) return null; // not an HF paper
  if (!res.ok) throw new Error(`HF ${res.status}`);
  const data = await res.json();
  return typeof data.upvotes === "number" ? data.upvotes : null;
}

async function pool(items, worker, concurrency) {
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, run),
  );
}

const WHERE = `source_type = 'arxiv' AND upvotes IS NULL AND deleted_at IS NULL${
  ALL ? "" : ` AND published_at >= unixepoch('now','-${SINCE_DAYS} days')`
}`;

async function main() {
  if (!ACCOUNT_ID || !API_TOKEN || !DB_ID) {
    throw new Error("Missing CLOUDFLARE_* credentials in .dev.vars");
  }
  const [{ total }] = await d1Remote(
    `SELECT count(*) AS total FROM papers WHERE ${WHERE}`,
  );
  console.log(
    `[backfill-upvotes] ${total} arXiv paper(s) missing upvotes${
      ALL ? " (all ages)" : ` (last ${SINCE_DAYS} days)`
    }.${DRY_RUN ? " (DRY RUN)" : ""}`,
  );

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  while (true) {
    if (LIMIT && processed >= LIMIT) break;
    const take = LIMIT ? Math.min(BATCH, LIMIT - processed) : BATCH;
    const rows = await d1Remote(
      `SELECT id, source_url FROM papers WHERE ${WHERE} LIMIT ?`,
      [take],
    );
    if (rows.length === 0) break;

    await pool(
      rows,
      async (row) => {
        processed++;
        const id = arxivId(row.source_url);
        if (!id) {
          skipped++;
          console.warn(`  - ${row.id}: no arxiv id in ${row.source_url}`);
          return;
        }
        try {
          const upvotes = await fetchUpvotes(id);
          if (upvotes === null) {
            skipped++;
            console.warn(`  - ${row.id} (${id}): not on HF / no upvotes`);
            return;
          }
          if (DRY_RUN) {
            console.log(`  • ${row.id} (${id}): ${upvotes}`);
            updated++;
            return;
          }
          await d1Remote("UPDATE papers SET upvotes = ? WHERE id = ?", [
            upvotes,
            row.id,
          ]);
          updated++;
          console.log(`  ✓ ${row.id} (${id}): ${upvotes}`);
        } catch (e) {
          failed++;
          console.warn(`  ✗ ${row.id} (${id}): ${e.message}`);
        }
      },
      CONCURRENCY,
    );

    // dry-run never clears NULLs, so stop after one batch/limit to avoid looping.
    if (DRY_RUN && !LIMIT) break;
  }
  console.log(
    `[backfill-upvotes] done. processed=${processed} updated=${updated} skipped=${skipped} failed=${failed}`,
  );
}

main().catch((e) => {
  console.error("[backfill-upvotes] fatal:", e);
  process.exit(1);
});
