#!/usr/bin/env node
/**
 * Backfill papers.page_count for MinerU-processed papers.
 *
 * Since the MinerU extraction path landed (2026-08-05), page_count has been
 * NULL for every MinerU-parsed paper: the batch-result API only returns
 * extract_progress.total_pages while state=running — the "done" response the
 * pipeline reads has no extract_progress at all. The fix reads the page count
 * from the result zip's metadata (layout.json / *_content_list.json); this
 * script applies the same logic to existing papers by re-fetching each paper's
 * batch result (mineru_batch_id is stored) and parsing its zip. Nothing is
 * re-submitted to MinerU and nothing but papers.page_count is written.
 *
 * Runs through tsx (imports production .ts modules so the parsing logic is
 * identical to queue-consumer's):
 *   npm run db:backfill-page-count -- [--dry-run] [--limit N]
 *
 * Requires CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN /
 * CLOUDFLARE_D1_DATABASE_ID / MINERU_TOKEN in .dev.vars. Remote-only: it
 * touches the production D1 via REST and MinerU's API, there is no local
 * variant. If fetch() fails with a network error on the host, retry with
 * NODE_USE_ENV_PROXY=1 (see project memory: X repost proxy).
 *
 * Safety:
 *   - Idempotent & resumable: candidates are `page_count IS NULL`, updates are
 *     guarded with `AND page_count IS NULL`; a re-run skips filled papers.
 *   - Per-paper try/catch: an expired batch / broken zip is recorded and
 *     skipped, failed ids are listed at the end for a retry.
 *   - Serial with a small gap, well inside MinerU's API rate limits.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getBatchResult } from "../src/lib/mineru.ts";
import { parseMineruZip } from "../src/lib/mineru-zip.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// ---------- args ----------
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 0; // 0 = no limit
const GAP_MS = 500;

// ---------- env (.dev.vars) ----------
function loadDevVars() {
  let raw;
  try {
    raw = readFileSync(join(projectRoot, ".dev.vars"), "utf8");
  } catch {
    return {};
  }
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- D1 (REST) ----------
// Retried: the REST endpoint intermittently returns 7429 ("storage operation
// exceeded timeout") — observed on the very first trial run.
const D1_ATTEMPTS = 3;

async function d1(sql, params = []) {
  let lastError;
  for (let attempt = 1; attempt <= D1_ATTEMPTS; attempt++) {
    try {
      return await d1Once(sql, params);
    } catch (err) {
      lastError = err;
      if (attempt < D1_ATTEMPTS) await sleep(2000 * attempt);
    }
  }
  throw lastError;
}

async function d1Once(sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${E.CLOUDFLARE_ACCOUNT_ID}/d1/database/${E.CLOUDFLARE_D1_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${E.CLOUDFLARE_API_TOKEN}`,
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

// ---------- per-paper ----------
async function backfillPaper(paper) {
  const result = await getBatchResult(E.MINERU_TOKEN, paper.mineru_batch_id);
  if (result.state !== "done" || !result.fullZipUrl) {
    throw new Error(
      `batch ${paper.mineru_batch_id} not usable (state=${result.state}, zip=${result.fullZipUrl ? "yes" : "no"})`,
    );
  }

  const zipResp = await fetch(result.fullZipUrl);
  if (!zipResp.ok) {
    throw new Error(`zip download failed with status ${zipResp.status}`);
  }
  const zipBytes = new Uint8Array(await zipResp.arrayBuffer());

  const { pageCount } = parseMineruZip(zipBytes);
  if (pageCount == null) {
    throw new Error("zip metadata yields no page count");
  }

  // Guarded so a concurrent pipeline write (or a re-run race) never clobbers.
  await d1(
    "UPDATE papers SET page_count = ? WHERE id = ? AND page_count IS NULL",
    [pageCount, paper.id],
  );
  return pageCount;
}

// ---------- main ----------
async function main() {
  const missing = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_D1_DATABASE_ID",
    ...(DRY_RUN ? [] : ["MINERU_TOKEN"]),
  ].filter((k) => !E[k]);
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(", ")} in .dev.vars`);
  }

  const papers = await d1(
    `SELECT id, mineru_batch_id, substr(title, 1, 60) AS title
     FROM papers
     WHERE page_count IS NULL AND mineru_batch_id IS NOT NULL
       AND deleted_at IS NULL
     ORDER BY created_at${LIMIT > 0 ? ` LIMIT ${LIMIT}` : ""}`,
  );
  console.log(
    `[backfill-page-count] ${papers.length} paper(s) missing page_count${DRY_RUN ? " (DRY RUN)" : ""}`,
  );

  if (DRY_RUN) {
    for (const p of papers) {
      console.log(`  [dry-run] ${p.id} batch=${p.mineru_batch_id} ${p.title}`);
    }
    return;
  }

  let ok = 0;
  const failures = [];
  for (const [idx, p] of papers.entries()) {
    const label = `[${idx + 1}/${papers.length}] ${p.id}`;
    try {
      const pages = await backfillPaper(p);
      ok++;
      console.log(`✓ ${label} pages=${pages} ${p.title}`);
    } catch (err) {
      failures.push({ id: p.id, error: String(err?.message ?? err).slice(0, 200) });
      console.error(`✗ ${label} ${String(err?.message ?? err).slice(0, 200)}`);
    }
    if (idx < papers.length - 1) await sleep(GAP_MS);
  }

  console.log(
    `[backfill-page-count] done. ok=${ok} failed=${failures.length}`,
  );
  if (failures.length > 0) {
    console.log(`[backfill-page-count] failed ids (re-run to retry):`);
    for (const f of failures) console.log(`  ${f.id}: ${f.error}`);
  }
}

main().catch((e) => {
  console.error("[backfill-page-count] fatal:", e);
  process.exit(1);
});
