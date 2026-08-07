#!/usr/bin/env node
/**
 * Apply cleanMineruMarkdown() (ligature loss + garbled sub/sup fixes, see
 * src/lib/mineru-clean.ts) to the MinerU markdown already sitting in R2
 * (`paper-content/{id}/full.md`) and its derived artifacts.
 *
 * Why: the cleaning step landed in the parse pipeline after ~513 papers had
 * already been persisted, so their stored markdown (and the plain text the
 * chatbot reads) still contains the systematic MinerU transcription garble
 * (`difusion`, `Cl<sub>a</sub>ssic<sub>a</sub>l`, ...). This script re-derives
 * everything from the stored markdown — no MinerU calls, no LLM, no credits,
 * no writes to `papers`, and `paper-content/{id}/images/` is never touched.
 *
 * Per changed paper, writes happen in a deliberate order so an interrupted run
 * is safe to re-run:
 *   1. `paper-text/{id}.txt`  — markdownToPlainText(cleaned), same derivation
 *      as queue-consumer,
 *   2. `paper_contents.char_count` — cleaned.length,
 *   3. `paper-content/{id}/full.md` — cleaned markdown, written LAST as the
 *      "this paper is done" marker: cleanMineruMarkdown is idempotent, so on a
 *      re-run a finished paper reads back its cleaned full.md, cleans to the
 *      same string and is skipped; an unfinished paper is fully redone and the
 *      derived overwrites are harmless.
 *
 * Defensive image-ref check: by construction the cleaner cannot alter image
 * references (its replacement alphabets contain no `/()`), but before writing
 * anything the `![...](...)` sequence of original and cleaned markdown is
 * compared; a mismatch marks the paper failed and skips all writes for it.
 *
 * Safety:
 *   - Idempotent & resumable (see write order above).
 *   - Per-paper try/catch: a failure is recorded and skipped, never aborts the
 *     batch; failed ids are listed at the end (re-run to retry).
 *   - Row-count guard on the candidate query, mirroring the other backfills.
 *   - `--dry-run` reads and cleans but writes nothing; reports the papers that
 *     would change with their byte delta and image-ref check result.
 *   - `--cache-dir <dir>` reads the original markdown from `{dir}/{id}.md`
 *     instead of R2 GET. DRY-RUN ONLY (enforced): a real run must read from R2,
 *     because a local mirror can be stale (paper re-parsed, or already cleaned
 *     by a previous run) and writing content derived from it would overwrite
 *     the newer R2 full.md with an old version.
 *
 * Usage (run on the host):
 *   npm run db:backfill-clean-garble -- [--dry-run] [--limit N] [--local]
 *                                       [--cache-dir <dir>]
 *
 * --remote (default) needs CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN /
 * CLOUDFLARE_D1_DATABASE_ID in .dev.vars.
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { cleanMineruMarkdown } from "../src/lib/mineru-clean.ts";
import { markdownToPlainText } from "../src/lib/paper-content.ts";
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
if (Number.isNaN(LIMIT)) {
  console.error(`[clean-garble] invalid --limit value: ${getOpt("--limit", "0")}`);
  process.exit(1);
}
const CACHE_DIR = getOpt("--cache-dir", "");
if (!DRY_RUN && CACHE_DIR) {
  console.error(
    "[clean-garble] --cache-dir is dry-run only: a real run must read the current full.md from R2 (a local mirror can be stale and would overwrite newer content with an old version).",
  );
  process.exit(1);
}
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

// ---------- D1 ----------
async function d1Remote(sql, params = []) {
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

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

// `wrangler d1 execute --command` has no bound-parameter support, so `?`
// placeholders are inlined as escaped literals. Only script-controlled values
// (uuids, integers) ever reach this path.
function d1Local(sql, params = []) {
  let i = 0;
  const inlined = sql.replace(/\?/g, () => sqlLiteral(params[i++]));
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", "--local", "--json", "--command", inlined],
    {
      cwd: projectRoot,
      env: wranglerEnv,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  // wrangler may print notices before the JSON array — slice from the first '['.
  const jsonStart = out.indexOf("[");
  if (jsonStart === -1) {
    throw new Error(`wrangler d1 execute produced no JSON: ${out.slice(0, 200)}`);
  }
  return JSON.parse(out.slice(jsonStart))[0].results;
}

async function d1(sql, params = []) {
  return REMOTE ? d1Remote(sql, params) : d1Local(sql, params);
}

// ---------- image-ref check ----------
const IMAGE_REF_RE = /!\[[^\]]*\]\([^)]*\)/g;

function imageRefsMatch(original, cleaned) {
  const a = original.match(IMAGE_REF_RE) ?? [];
  const b = cleaned.match(IMAGE_REF_RE) ?? [];
  if (a.length !== b.length) return false;
  return a.every((ref, i) => ref === b[i]);
}

// ---------- per-paper ----------
async function readOriginal(paper, tmp) {
  if (CACHE_DIR) {
    const cachePath = join(CACHE_DIR, `${paper.paper_id}.md`);
    if (existsSync(cachePath)) {
      return { markdown: readFileSync(cachePath, "utf8"), source: "cache" };
    }
  }
  const mdPath = join(tmp, "full.md");
  // Remove any leftover from the previous paper so a silently-failed get can
  // never make this paper read the previous paper's markdown.
  rmSync(mdPath, { force: true });
  await r2(`r2 get ${paper.paper_id}`, [
    "r2", "object", "get",
    `${BUCKET}/${paper.markdown_r2_key}`,
    "--file", mdPath, R2_FLAG,
  ]);
  return { markdown: readFileSync(mdPath, "utf8"), source: "r2" };
}

async function cleanOne(paper, tmp) {
  const { markdown, source } = await readOriginal(paper, tmp);
  const cleaned = cleanMineruMarkdown(markdown);

  if (cleaned === markdown) {
    return { outcome: "skipped", source };
  }
  if (!imageRefsMatch(markdown, cleaned)) {
    throw new Error("image reference sequence changed by cleaning — refusing to write");
  }

  const byteDelta = Buffer.byteLength(cleaned) - Buffer.byteLength(markdown);
  if (DRY_RUN) {
    return { outcome: "changed", source, byteDelta };
  }

  // 1. plain text (chatbot's readPaper source), same derivation as queue-consumer.
  const plainText = markdownToPlainText(cleaned);
  if (plainText.trim().length === 0) {
    throw new Error("cleaned markdown produced empty plain text");
  }
  const txtPath = join(tmp, "text.txt");
  writeFileSync(txtPath, plainText);
  await r2(`r2 put text ${paper.paper_id}`, [
    "r2", "object", "put",
    `${BUCKET}/${paperTextKey(paper.paper_id)}`,
    "--file", txtPath,
    "--content-type", "text/plain; charset=utf-8",
    R2_FLAG,
  ]);

  // 2. char_count follows the markdown that is about to be written.
  await d1("UPDATE paper_contents SET char_count = ? WHERE paper_id = ?", [
    cleaned.length,
    paper.paper_id,
  ]);

  // 3. full.md LAST — the completion marker (see header).
  const mdOutPath = join(tmp, "full-clean.md");
  writeFileSync(mdOutPath, cleaned);
  await r2(`r2 put md ${paper.paper_id}`, [
    "r2", "object", "put",
    `${BUCKET}/${paper.markdown_r2_key}`,
    "--file", mdOutPath,
    "--content-type", "text/markdown; charset=utf-8",
    R2_FLAG,
  ]);

  return { outcome: "changed", source, byteDelta };
}

// ---------- main ----------
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

const FROM =
  "paper_contents pc JOIN papers p ON p.id = pc.paper_id AND p.deleted_at IS NULL";

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

  const [{ total }] = await d1(`SELECT COUNT(*) AS total FROM ${FROM}`);
  const papers = await d1(
    `SELECT pc.paper_id, pc.markdown_r2_key FROM ${FROM} ORDER BY pc.created_at${LIMIT > 0 ? ` LIMIT ${LIMIT}` : ""}`,
  );
  const expected = LIMIT > 0 ? Math.min(Number(total), LIMIT) : Number(total);
  if (papers.length !== expected) {
    throw new Error(
      `Row count mismatch: COUNT(*)=${total}${LIMIT > 0 ? `, limit=${LIMIT}` : ""}, but SELECT returned ${papers.length} row(s) (expected ${expected}). Possible truncation — aborting instead of processing a partial set.`,
    );
  }

  console.log(
    `[clean-garble] mode=${REMOTE ? "remote" : "local"}${CACHE_DIR ? ` cache-dir=${CACHE_DIR}` : ""} ${total} paper(s) with MinerU content, processing ${papers.length}${DRY_RUN ? " (DRY RUN — no writes)" : ""}`,
  );

  const tmp = mkdtempSync(join(tmpdir(), "clean-garble-"));
  const runStart = Date.now();
  const changed = [];
  const skipped = [];
  const failures = [];
  const sources = { cache: 0, r2: 0 };

  for (const [idx, p] of papers.entries()) {
    const label = `[${idx + 1}/${papers.length}] ${p.paper_id}`;
    const start = Date.now();
    try {
      const r = await cleanOne(p, tmp);
      sources[r.source]++;
      if (r.outcome === "skipped") {
        skipped.push(p.paper_id);
      } else {
        changed.push(p.paper_id);
        const delta = r.byteDelta >= 0 ? `+${r.byteDelta}` : `${r.byteDelta}`;
        console.log(
          `${DRY_RUN ? "~" : "✓"} ${label} ${DRY_RUN ? "would change" : "cleaned"} (${delta}B, image refs OK, src=${r.source}) in ${fmtDuration(Date.now() - start)}`,
        );
      }
    } catch (err) {
      failures.push({ id: p.paper_id, error: String(err?.message ?? err).slice(0, 300) });
      console.error(
        `✗ ${label} failed after ${fmtDuration(Date.now() - start)}: ${String(err?.message ?? err).slice(0, 300)}`,
      );
    }
  }

  rmSync(tmp, { recursive: true, force: true });

  console.log("");
  console.log(
    `[clean-garble] ${DRY_RUN ? "dry run " : ""}done in ${fmtDuration(Date.now() - runStart)}. scanned=${papers.length} changed=${changed.length} skipped=${skipped.length} failed=${failures.length} (source: cache=${sources.cache} r2=${sources.r2})`,
  );
  if (DRY_RUN && CACHE_DIR && sources.cache > 0) {
    console.log(
      `[clean-garble] NOTE: dry-run numbers based on ${sources.cache} local cache file(s); stale vs R2 if papers were re-parsed or a previous real run already cleaned them.`,
    );
  }
  if (failures.length > 0) {
    console.log("[clean-garble] failed ids (nothing written for these; re-run to retry):");
    for (const f of failures) console.log(`  ${f.id}: ${f.error}`);
  }
}

main().catch((e) => {
  console.error("[clean-garble] fatal:", e);
  process.exit(1);
});
