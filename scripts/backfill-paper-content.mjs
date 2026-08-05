#!/usr/bin/env node
/**
 * Backfill MinerU paper content (R2 `paper-content/{paperId}/` + `paper_contents`
 * row) for existing gallery papers.
 *
 * The MinerU-based extraction pipeline landed after ~500 gallery papers had
 * already been processed with the old pdfjs path, so those papers have no
 * markdown/images and the reader view shows "unavailable" for them. This script
 * re-runs *only* the extraction+persist half of the pipeline for them.
 *
 * All the real logic is imported from production modules (src/lib/mineru.ts,
 * src/lib/mineru-zip.ts, src/lib/paper-content.ts) so the backfilled artifacts
 * are byte-identical to what queue-consumer's persistMineruContent() writes —
 * this file is orchestration only. That is also why it must be run through tsx
 * (`npm run db:backfill-paper-content`), plain node can't import the .ts deps.
 *
 * Deliberately NOT done (this is a pure additive backfill):
 *   - no writes to `papers` / `paper_results` (no title, no page_count, no
 *     mineru_batch_id — the batch is one-shot here and never re-polled),
 *   - no LLM calls at all (no trimPaperTail, no summaries — those already exist),
 *   - no overwrite of `paper-text/{id}.txt`: the existing objects are pdfjs plain
 *     text and the chatbot reads them. Replacing them with MinerU-derived text is
 *     a behaviour change, out of scope here,
 *   - no credit accounting.
 *
 * Safety:
 *   - Idempotent & resumable: candidates are papers with NO `paper_contents` row,
 *     so a re-run skips everything already backfilled.
 *   - Serial: one paper at a time with a gap between papers, to stay well inside
 *     MinerU's per-account concurrency/rate limits.
 *   - Per-paper try/catch: MinerU failure / timeout / broken zip is recorded and
 *     skipped, never aborts the batch. Failed ids are printed as a list at the end
 *     so they can be retried by simply re-running.
 *   - Preflight aborts if the `paper_contents` table is missing (migration 0026
 *     not applied yet) instead of failing once per paper.
 *   - Row-count guard on the candidate query, mirroring backfill-paper-text.mjs.
 *   - `--dry-run` resolves candidates and prints them without calling MinerU or
 *     writing anything.
 *
 * Usage (run on the host):
 *   npm run db:backfill-paper-content -- [--dry-run] [--limit N] [--local]
 *                                        [--poll-interval S] [--timeout M]
 *                                        [--gap S] [--image-batch N]
 *
 * Defaults: remote (D1 REST + R2 --remote), no limit, poll every 15s, 20min
 * per-paper timeout, 3s gap between papers, 20 images per R2 write batch.
 *
 * --remote needs CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN /
 * CLOUDFLARE_D1_DATABASE_ID in .dev.vars; both modes need MINERU_TOKEN.
 *
 * If the D1 REST fetch() call fails with a network error on the host, retry
 * with NODE_USE_ENV_PROXY=1 (see project memory: X repost proxy).
 */
import { execFile, execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createBatch, getBatchResult } from "../src/lib/mineru.ts";
import {
  buildImageResolver,
  parseMineruZip,
  rewriteImageRefs,
} from "../src/lib/mineru-zip.ts";
import {
  markdownImagePath,
  markdownToPlainText,
  paperContentImageKey,
  paperContentMarkdownKey,
  stripDangerousHtml,
} from "../src/lib/paper-content.ts";

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
const POLL_INTERVAL_MS = Math.max(1, Number(getOpt("--poll-interval", "15"))) * 1000;
const PAPER_TIMEOUT_MS = Math.max(1, Number(getOpt("--timeout", "20"))) * 60 * 1000;
const GAP_MS = Math.max(0, Number(getOpt("--gap", "3"))) * 1000;
// Each R2 put is a whole `npx wrangler` process here (queue-consumer can afford
// 20 at a time because it writes through the binding). Against --local that is
// fatal: several wrangler processes writing the same miniflare R2 store at once
// fail with "Network connection lost." / "put: Unspecified error (0)"
// (reproduced at concurrency 2, 4, 8 and 20; sequential is clean), so --local
// defaults to sequential. --remote processes each talk to the real R2 API and
// share no local state, so they can overlap.
const IMAGE_PUT_BATCH = Math.max(
  1,
  Number(getOpt("--image-batch", REMOTE ? "8" : "1")),
);
const R2_PUT_ATTEMPTS = 3;

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
// bucket_name for the PAPERS_BUCKET binding, per wrangler.jsonc.
const BUCKET = "picx-papers-apac";

/** Aborts the whole run instead of being counted as one paper's failure. */
class FatalError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- wrangler ----------
// Proxy env vars make wrangler's remote calls fail with `code: 7403 account not
// authorized`, so they are stripped from the child env (harmless for --local,
// and it also drops wrangler's "Proxy environment variables detected." notice).
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

function wrangler(cmd) {
  return execFileSync("npx", ["wrangler", ...cmd], {
    cwd: projectRoot,
    env: wranglerEnv,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function wranglerAsync(cmd) {
  return execFileAsync("npx", ["wrangler", ...cmd], {
    cwd: projectRoot,
    env: wranglerEnv,
    maxBuffer: 64 * 1024 * 1024,
  });
}

const R2_FLAG = REMOTE ? "--remote" : "--local";

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
// (uuids, r2 keys, integers) ever reach this path.
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

// ---------- R2 ----------
function r2Get(key, filePath) {
  wrangler(["r2", "object", "get", `${BUCKET}/${key}`, "--file", filePath, R2_FLAG]);
}

// Retried: R2 puts fail transiently under concurrency (see IMAGE_PUT_BATCH).
// Losing a single image would otherwise sink the whole paper after MinerU has
// already been paid for.
async function r2Put(key, filePath, contentType) {
  let lastError;
  for (let attempt = 1; attempt <= R2_PUT_ATTEMPTS; attempt++) {
    try {
      return await wranglerAsync([
        "r2",
        "object",
        "put",
        `${BUCKET}/${key}`,
        "--file",
        filePath,
        "--content-type",
        contentType,
        R2_FLAG,
      ]);
    } catch (err) {
      lastError = err;
      if (attempt < R2_PUT_ATTEMPTS) await sleep(1000 * attempt);
    }
  }
  throw new Error(
    `r2 object put failed for ${key} after ${R2_PUT_ATTEMPTS} attempts: ${String(lastError?.stderr || lastError?.message || lastError).slice(0, 300)}`,
  );
}

// ---------- MinerU ----------
async function runMineru(pdfBuffer, filename, log) {
  const token = E.MINERU_TOKEN;
  const created = await createBatch(token, {
    filename,
    size: pdfBuffer.byteLength,
  });
  // Never set Content-Type: the OSS presigned url signs it as empty, setting it
  // makes the signature mismatch → 403. (Mirrors queue-consumer.)
  const uploadResp = await fetch(created.uploadUrl, {
    method: "PUT",
    body: pdfBuffer,
  });
  if (!uploadResp.ok) {
    throw new Error(
      `Upload PDF to MinerU storage failed with status ${uploadResp.status}`,
    );
  }
  log(`submitted, batch ${created.batchId}`);

  const deadline = Date.now() + PAPER_TIMEOUT_MS;
  let consecutiveQueryErrors = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let result;
    try {
      result = await getBatchResult(token, created.batchId);
      consecutiveQueryErrors = 0;
    } catch (err) {
      consecutiveQueryErrors++;
      // Repeated status-query failures usually mean a rate limit or an expired
      // token, i.e. every subsequent paper would fail the same way — bail out.
      if (consecutiveQueryErrors >= 5) {
        throw new FatalError(
          `MinerU status query failed ${consecutiveQueryErrors}x in a row (rate limit / bad token?): ${String(err).slice(0, 200)}`,
        );
      }
      log(`status query failed, retrying (${String(err).slice(0, 120)})`);
      continue;
    }
    if (result.state === "done") {
      if (!result.fullZipUrl) throw new Error("MinerU done but returned no zip url");
      return result;
    }
    if (result.state === "failed") {
      throw new Error(`MinerU parse failed: ${result.errMsg || "unknown"}`);
    }
    log(`state=${result.state}`);
  }
  throw new Error(
    `MinerU timed out after ${Math.round(PAPER_TIMEOUT_MS / 60000)}min (batch ${created.batchId})`,
  );
}

// ---------- per-paper ----------
async function backfillPaper(paper, tmp, log) {
  const pdfPath = join(tmp, "cur.pdf");
  r2Get(paper.pdf_r2_key, pdfPath);
  const pdfBuffer = readFileSync(pdfPath);

  const mineruStart = Date.now();
  const filename = paper.pdf_r2_key.split("/").pop() || `${paper.id}.pdf`;
  const result = await runMineru(
    pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength,
    ),
    filename,
    log,
  );

  const mineruMs = Date.now() - mineruStart;

  const zipResp = await fetch(result.fullZipUrl);
  if (!zipResp.ok) {
    throw new Error(`Downloading MinerU zip failed with status ${zipResp.status}`);
  }
  const zipBytes = new Uint8Array(await zipResp.arrayBuffer());

  const { markdown, images } = parseMineruZip(zipBytes);
  if (markdown.trim().length === 0) {
    throw new Error("MinerU zip has no usable markdown");
  }

  const resolver = buildImageResolver(images, (img) =>
    markdownImagePath(img.storedName),
  );
  const rewritten = stripDangerousHtml(rewriteImageRefs(markdown, resolver));
  if (markdownToPlainText(rewritten).trim().length === 0) {
    throw new Error("MinerU markdown produced empty plain text");
  }

  // Write images first, markdown last: if the run dies midway the markdown
  // object (and the paper_contents row gating the reader view) is still absent,
  // so the paper stays a candidate and gets fully redone on the next run.
  let imageBytes = 0;
  const uploadStart = Date.now();
  const imageDir = join(tmp, "img");
  for (let i = 0; i < images.length; i += IMAGE_PUT_BATCH) {
    const batch = images.slice(i, i + IMAGE_PUT_BATCH);
    await Promise.all(
      batch.map(async (img, j) => {
        const path = join(imageDir, `${i + j}`);
        writeFileSync(path, img.bytes);
        imageBytes += img.bytes.byteLength;
        await r2Put(
          paperContentImageKey(paper.id, img.storedName),
          path,
          img.mime,
        );
      }),
    );
  }

  const mdPath = join(tmp, "full.md");
  writeFileSync(mdPath, rewritten);
  const markdownBytes = Buffer.byteLength(rewritten);
  await r2Put(
    paperContentMarkdownKey(paper.id),
    mdPath,
    "text/markdown; charset=utf-8",
  );
  const uploadMs = Date.now() - uploadStart;

  // paper_id is unique; delete-then-insert keeps a partially-failed previous run
  // from blocking the retry (D1 has no transactions — the gap is fine, nothing
  // else writes this row).
  await d1("DELETE FROM paper_contents WHERE paper_id = ?", [paper.id]);
  await d1(
    "INSERT INTO paper_contents (id, paper_id, markdown_r2_key, source, image_count, char_count, created_at) VALUES (?, ?, ?, 'mineru', ?, ?, ?)",
    [
      crypto.randomUUID(),
      paper.id,
      paperContentMarkdownKey(paper.id),
      images.length,
      rewritten.length,
      Math.floor(Date.now() / 1000),
    ],
  );

  return {
    pages: result.totalPages ?? paper.page_count ?? null,
    mineruMs,
    uploadMs,
    imageCount: images.length,
    imageBytes,
    markdownBytes,
    charCount: rewritten.length,
  };
}

// ---------- main ----------
const WHERE =
  "p.is_listed_in_gallery = 1 AND p.status = 'completed' AND p.deleted_at IS NULL AND pc.paper_id IS NULL";
const FROM =
  "papers p LEFT JOIN paper_contents pc ON pc.paper_id = p.id";

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
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
        `Missing ${missing.join(", ")} in .dev.vars (required for --remote; pass --local to run against the local D1/R2 emulation instead)`,
      );
    }
  }
  if (!DRY_RUN && !E.MINERU_TOKEN) {
    throw new Error("Missing MINERU_TOKEN in .dev.vars");
  }

  // Preflight: the whole backfill is gated on migration 0026. Without this the
  // run would emit one identical "no such table" failure per paper.
  const tables = await d1(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'paper_contents'",
  );
  if (tables.length === 0) {
    throw new Error(
      `Table \`paper_contents\` does not exist — migration 0026 has not been applied to this database. Apply it first (wrangler d1 migrations apply DB ${REMOTE ? "--remote" : "--local"}), then re-run.`,
    );
  }

  const [{ total }] = await d1(
    `SELECT COUNT(*) AS total FROM ${FROM} WHERE ${WHERE}`,
  );
  const papers = await d1(
    `SELECT p.id, p.pdf_r2_key, p.page_count FROM ${FROM} WHERE ${WHERE} ORDER BY p.created_at${LIMIT > 0 ? ` LIMIT ${LIMIT}` : ""}`,
  );
  const expected = LIMIT > 0 ? Math.min(Number(total), LIMIT) : Number(total);
  if (papers.length !== expected) {
    throw new Error(
      `Row count mismatch: COUNT(*)=${total}${LIMIT > 0 ? `, limit=${LIMIT}` : ""}, but SELECT returned ${papers.length} row(s) (expected ${expected}). Possible truncation — aborting instead of backfilling a partial set.`,
    );
  }

  console.log(
    `[backfill-content] mode=${REMOTE ? "remote" : "local"} ${total} paper(s) missing content, processing ${papers.length}${DRY_RUN ? " (DRY RUN)" : ""}`,
  );

  if (DRY_RUN) {
    for (const p of papers) {
      console.log(`  [dry-run] ${p.id} (${p.page_count ?? "?"}p) ${p.pdf_r2_key}`);
    }
    console.log(`[backfill-content] dry run done. candidates=${papers.length}`);
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), "paper-content-"));
  mkdirSync(join(tmp, "img"), { recursive: true });

  const runStart = Date.now();
  const stats = [];
  const failures = [];
  let fatal = null;

  for (const [idx, p] of papers.entries()) {
    const label = `[${idx + 1}/${papers.length}] ${p.id}`;
    const log = (m) => console.log(`  ${label}: ${m}`);
    const start = Date.now();
    try {
      const r = await backfillPaper(p, tmp, log);
      const elapsed = Date.now() - start;
      stats.push({ id: p.id, elapsed, ...r });
      console.log(
        `✓ ${label} pages=${r.pages ?? "?"} time=${fmtDuration(elapsed)} (mineru ${fmtDuration(r.mineruMs)} / upload ${fmtDuration(r.uploadMs)}) images=${r.imageCount} md=${fmtBytes(r.markdownBytes)} r2=${fmtBytes(r.markdownBytes + r.imageBytes)}`,
      );
    } catch (err) {
      if (err instanceof FatalError) {
        fatal = err;
        break;
      }
      failures.push({ id: p.id, error: String(err?.message ?? err).slice(0, 300) });
      console.error(
        `✗ ${label} failed after ${fmtDuration(Date.now() - start)}: ${String(err?.message ?? err).slice(0, 300)}`,
      );
    }
    if (idx < papers.length - 1) await sleep(GAP_MS);
  }

  rmSync(tmp, { recursive: true, force: true });

  const totalElapsed = Date.now() - runStart;
  const sum = (f) => stats.reduce((a, s) => a + f(s), 0);
  const totalR2 = sum((s) => s.markdownBytes + s.imageBytes);
  console.log("");
  console.log(
    `[backfill-content] done in ${fmtDuration(totalElapsed)}. ok=${stats.length} failed=${failures.length}`,
  );
  if (stats.length > 0) {
    console.log(
      `[backfill-content] pages=${sum((s) => s.pages ?? 0)} images=${sum((s) => s.imageCount)} markdown=${fmtBytes(sum((s) => s.markdownBytes))} images=${fmtBytes(sum((s) => s.imageBytes))} r2Total=${fmtBytes(totalR2)}`,
    );
    console.log(
      `[backfill-content] per paper avg: time=${fmtDuration(sum((s) => s.elapsed) / stats.length)} (mineru ${fmtDuration(sum((s) => s.mineruMs) / stats.length)} / upload ${fmtDuration(sum((s) => s.uploadMs) / stats.length)}) images=${(sum((s) => s.imageCount) / stats.length).toFixed(1)} r2=${fmtBytes(Math.round(totalR2 / stats.length))}`,
    );
  }
  if (failures.length > 0) {
    console.log(`[backfill-content] failed ids (re-run to retry):`);
    for (const f of failures) console.log(`  ${f.id}: ${f.error}`);
  }
  if (fatal) {
    throw fatal;
  }
}

main().catch((e) => {
  console.error("[backfill-content] fatal:", e);
  process.exit(1);
});
