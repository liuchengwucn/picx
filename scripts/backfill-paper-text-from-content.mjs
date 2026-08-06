#!/usr/bin/env node
/**
 * Rewrite `paper-text/{id}.txt` (the chatbot's readPaper source) from the
 * MinerU markdown already sitting in R2 (`paper-content/{id}/full.md`).
 *
 * Why: backfill-paper-content.mjs deliberately did not touch paper-text, so the
 * ~500 backfilled gallery papers still serve the old pdfjs plain text to the
 * chatbot while the reader view shows MinerU markdown. This script closes that
 * gap using the exact derivation queue-consumer applies to new papers
 * (markdownToPlainText: strip image refs and heading '#', collapse blank runs;
 * tables and formulas kept). No MinerU calls, no D1 writes, no LLM, no credits.
 *
 * Candidates: every paper with a `paper_contents` row (i.e. everything that has
 * a full.md). Papers processed by the new pipeline are included — for them the
 * rewrite produces identical content, which keeps the candidate query simple.
 * pdfjs-only papers have no row and are untouched.
 *
 * Idempotent by construction (pure overwrite of derived content); re-run to
 * retry any failures. `--dry-run` lists candidates without writing.
 *
 * Usage (run on the host):
 *   npm run db:backfill-paper-text-from-content -- [--dry-run] [--limit N]
 *                                                  [--local] [--concurrency N]
 *
 * --remote (default) needs CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN /
 * CLOUDFLARE_D1_DATABASE_ID in .dev.vars.
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { markdownToPlainText, paperContentMarkdownKey } from "../src/lib/paper-content.ts";
import { paperTextKey } from "../src/lib/paper-text.ts";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// ---------- args ----------
const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getOpt = (f, def) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DRY_RUN = hasFlag("--dry-run");
const REMOTE = !hasFlag("--local");
const LIMIT = Number(getOpt("--limit", "0")); // 0 = no limit
// Each paper is one wrangler get + one wrangler put against remote R2; the
// processes share no state, so a few in flight is safe (mirrors the remote
// image-batch experience in backfill-paper-content.mjs). --local wrangler
// processes corrupt each other's miniflare store, so local stays sequential.
const CONCURRENCY = Math.max(1, Number(getOpt("--concurrency", REMOTE ? "4" : "1")));
const R2_ATTEMPTS = 3;

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
const BUCKET = "picx-papers-apac";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- wrangler ----------
// Proxy env vars make wrangler's remote calls fail with `code: 7403 account not
// authorized`, so they are stripped from the child env.
const wranglerEnv = { ...process.env };
for (const k of [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
]) {
  delete wranglerEnv[k];
}

function wranglerAsync(cmd) {
  return execFileAsync("npx", ["wrangler", ...cmd], {
    cwd: projectRoot,
    env: wranglerEnv,
    maxBuffer: 64 * 1024 * 1024,
  });
}

const R2_FLAG = REMOTE ? "--remote" : "--local";

// Retried: the Cloudflare API intermittently drops a request ("Failed to fetch
// /accounts/..."). Observed a handful of times across the content backfill.
async function r2(cmdName, cmd) {
  let lastError;
  for (let attempt = 1; attempt <= R2_ATTEMPTS; attempt++) {
    try {
      return await wranglerAsync(cmd);
    } catch (err) {
      lastError = err;
      if (attempt < R2_ATTEMPTS) await sleep(2000 * attempt);
    }
  }
  throw new Error(
    `${cmdName} failed after ${R2_ATTEMPTS} attempts: ${String(lastError?.stderr || lastError?.message || lastError).slice(0, 300)}`,
  );
}

// ---------- D1 (read-only here) ----------
async function d1Remote(sql) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${E.CLOUDFLARE_ACCOUNT_ID}/d1/database/${E.CLOUDFLARE_D1_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${E.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params: [] }),
    },
  );
  const json = await res.json();
  if (!json.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(json.errors)}`);
  }
  return json.result[0].results;
}

function d1Local(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", "--local", "--json", "--command", sql],
    {
      cwd: projectRoot,
      env: wranglerEnv,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const jsonStart = out.indexOf("[");
  if (jsonStart === -1) {
    throw new Error(`wrangler d1 execute produced no JSON: ${out.slice(0, 200)}`);
  }
  return JSON.parse(out.slice(jsonStart))[0].results;
}

async function d1(sql) {
  return REMOTE ? d1Remote(sql) : d1Local(sql);
}

// ---------- per-paper ----------
async function rewriteOne(paper, tmp, slot) {
  const mdPath = join(tmp, `full-${slot}.md`);
  await r2(`r2 get ${paper.paper_id}`, [
    "r2", "object", "get",
    `${BUCKET}/${paperContentMarkdownKey(paper.paper_id)}`,
    "--file", mdPath, R2_FLAG,
  ]);
  const markdown = readFileSync(mdPath, "utf8");

  const plainText = markdownToPlainText(markdown);
  if (plainText.trim().length === 0) {
    throw new Error("markdown produced empty plain text");
  }

  const txtPath = join(tmp, `text-${slot}.txt`);
  writeFileSync(txtPath, plainText);
  await r2(`r2 put ${paper.paper_id}`, [
    "r2", "object", "put",
    `${BUCKET}/${paperTextKey(paper.paper_id)}`,
    "--file", txtPath, R2_FLAG,
  ]);

  return { markdownChars: markdown.length, textChars: plainText.length };
}

// ---------- main ----------
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

async function main() {
  if (REMOTE) {
    const missing = [
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_D1_DATABASE_ID",
    ].filter((k) => !E[k]);
    if (missing.length > 0) {
      throw new Error(
        `Missing ${missing.join(", ")} in .dev.vars (required for --remote; pass --local to run against the local emulation instead)`,
      );
    }
  }

  const [{ total }] = await d1("SELECT COUNT(*) AS total FROM paper_contents");
  const papers = await d1(
    `SELECT paper_id FROM paper_contents ORDER BY created_at${LIMIT > 0 ? ` LIMIT ${LIMIT}` : ""}`,
  );
  const expected = LIMIT > 0 ? Math.min(Number(total), LIMIT) : Number(total);
  if (papers.length !== expected) {
    throw new Error(
      `Row count mismatch: COUNT(*)=${total}${LIMIT > 0 ? `, limit=${LIMIT}` : ""}, but SELECT returned ${papers.length} row(s). Aborting instead of processing a partial set.`,
    );
  }

  console.log(
    `[backfill-text] mode=${REMOTE ? "remote" : "local"} concurrency=${CONCURRENCY} ${total} paper(s) with MinerU content, processing ${papers.length}${DRY_RUN ? " (DRY RUN)" : ""}`,
  );

  if (DRY_RUN) {
    for (const p of papers) console.log(`  [dry-run] ${p.paper_id}`);
    console.log(`[backfill-text] dry run done. candidates=${papers.length}`);
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), "paper-text-rewrite-"));
  const runStart = Date.now();
  const failures = [];
  let ok = 0;
  let nextIndex = 0;

  async function worker(slot) {
    while (true) {
      const idx = nextIndex++;
      if (idx >= papers.length) return;
      const p = papers[idx];
      const label = `[${idx + 1}/${papers.length}] ${p.paper_id}`;
      const start = Date.now();
      try {
        const r = await rewriteOne(p, tmp, slot);
        ok++;
        console.log(
          `✓ ${label} md=${r.markdownChars} → txt=${r.textChars} chars in ${fmtDuration(Date.now() - start)}`,
        );
      } catch (err) {
        failures.push({ id: p.paper_id, error: String(err?.message ?? err).slice(0, 300) });
        console.error(
          `✗ ${label} failed after ${fmtDuration(Date.now() - start)}: ${String(err?.message ?? err).slice(0, 300)}`,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, papers.length) }, (_, i) => worker(i)),
  );

  rmSync(tmp, { recursive: true, force: true });

  console.log("");
  console.log(
    `[backfill-text] done in ${fmtDuration(Date.now() - runStart)}. ok=${ok} failed=${failures.length}`,
  );
  if (failures.length > 0) {
    console.log("[backfill-text] failed ids (re-run to retry):");
    for (const f of failures) console.log(`  ${f.id}: ${f.error}`);
  }
}

main().catch((e) => {
  console.error("[backfill-text] fatal:", e);
  process.exit(1);
});
