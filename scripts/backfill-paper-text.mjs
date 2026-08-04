#!/usr/bin/env node
/**
 * Backfill full text to R2 (paper-text/{paperId}.txt) for existing papers.
 *
 * For each completed, non-deleted paper: download PDF from R2 via wrangler,
 * extract raw text with pdfjs-serverless (no tail-trim, mirrors the new
 * queue-consumer persist step which stores rawText), upload the .txt to R2.
 *
 * The page-text extraction (extractPageTextFromItems / joinPagesContinuously
 * below) is duplicated from src/lib/pdf.ts's extractPDFText so the backfilled
 * rawText matches what newly processed papers get — keep them in sync if
 * that joining logic changes (tail-trim itself is intentionally not ported;
 * this script always writes the untrimmed rawText, same as queue-consumer).
 *
 * NOTE: the key format must stay in sync with paperTextKey() in
 * src/lib/paper-text.ts — if that changes, update this script too.
 *
 * Safety:
 *   - Idempotent & resumable: skips papers whose text object already exists.
 *   - Per-paper try/catch: one failure never aborts the batch — EXCEPT
 *     r2Exists() failures that aren't a plain "key missing" (e.g. auth/login
 *     errors), which abort the whole run immediately so a bad credential
 *     doesn't produce hundreds of misleading per-paper "FAILED" lines.
 *   - --dry-run lists what would be done without writing.
 *   - --local runs entirely against the local D1/R2 emulation (via wrangler),
 *     no Cloudflare API credentials required or used.
 *   - Row-count guard: compares the fetched paper list against a COUNT(*)
 *     with the same WHERE clause and aborts on mismatch, to catch silent
 *     truncation instead of quietly backfilling a partial set.
 *
 * Usage (run on the host):
 *   node scripts/backfill-paper-text.mjs [--dry-run] [--limit N] [--local]
 *
 * Defaults: remote (D1 REST + R2 --remote), no limit.
 *
 * If the D1 REST fetch() call fails with a network error on the host, retry
 * with NODE_USE_ENV_PROXY=1 (see project memory: X repost proxy).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-serverless";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getOpt = (f, def) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DRY_RUN = hasFlag("--dry-run");
const REMOTE = !hasFlag("--local");
const LIMIT = Number(getOpt("--limit", "0"));

function loadDevVars() {
  let raw;
  try {
    raw = readFileSync(join(projectRoot, ".dev.vars"), "utf8");
  } catch {
    // .dev.vars is only required for --remote; --local doesn't need any
    // Cloudflare API credentials.
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

// Thrown for errors that must abort the whole run rather than being counted
// as a single paper's failure (e.g. auth/login problems surfacing through
// r2Exists — see its comment below).
class FatalError extends Error {}

function wrangler(cmd) {
  return execFileSync("npx", ["wrangler", ...cmd], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function d1Remote(sql) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${E.CLOUDFLARE_ACCOUNT_ID}/d1/database/${E.CLOUDFLARE_D1_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${E.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql }),
    },
  );
  const json = await res.json();
  if (!json.success) throw new Error(`D1 query failed: ${JSON.stringify(json.errors)}`);
  return json.result[0].results;
}

function d1Local(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", "--local", "--json", "--command", sql],
    { cwd: projectRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  // In this environment wrangler prints a "Proxy environment variables
  // detected." notice on stdout before the JSON array — slice from the
  // first '[' to isolate the actual payload (confirmed by manual testing).
  const jsonStart = out.indexOf("[");
  if (jsonStart === -1) {
    throw new Error(`wrangler d1 execute produced no JSON: ${out.slice(0, 200)}`);
  }
  const parsed = JSON.parse(out.slice(jsonStart));
  return parsed[0].results;
}

async function d1Query(sql) {
  return REMOTE ? d1Remote(sql) : d1Local(sql);
}

// `--file /dev/null` does not work here: when this script is invoked via the
// `mac` host bridge, absolute paths get VM-prefix-translated and /dev/null
// no longer resolves to a real device on the target side (confirmed by
// manual testing: wrangler throws EACCES trying to open the translated
// path). Use a real scratch file instead.
//
// Distinguishing "key missing" from other errors matters: wrangler's 404
// ("The specified key does not exist.", confirmed by manual testing) means
// "not backfilled yet"; anything else (auth/login/network) is a systemic
// problem that would otherwise get silently swallowed as "doesn't exist" and
// then produce a wall of misleading per-paper download/upload failures. Bail
// out immediately instead via FatalError.
function r2Exists(key, probePath) {
  const flag = REMOTE ? "--remote" : "--local";
  try {
    wrangler(["r2", "object", "get", `${BUCKET}/${key}`, "--file", probePath, flag]);
    return true;
  } catch (err) {
    const stderr = err?.stderr ? err.stderr.toString() : String(err);
    if (/does not exist/i.test(stderr)) {
      return false;
    }
    throw new FatalError(
      `r2 object get failed for a reason other than "key missing" (likely auth/login) — aborting run: ${stderr.slice(0, 300)}`,
    );
  }
}

// ---- page-text extraction, mirrors src/lib/pdf.ts (kept in sync) ----
function normalizePageText(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v 　]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractPageTextFromItems(items) {
  const chunks = [];
  for (const item of items) {
    if (typeof item.str === "string") {
      const value = item.str.replaceAll("\0", "").trim();
      if (value.length > 0) {
        chunks.push(value);
      }
      chunks.push(item.hasEOL ? "\n" : " ");
    }
  }
  return normalizePageText(chunks.join(""));
}

function shouldMergeHyphenatedWord(previousText, nextText) {
  return /[A-Za-z]-$/.test(previousText) && /^[a-z]/.test(nextText);
}

function joinPagesContinuously(pageTexts) {
  let rawText = "";
  for (const pageText of pageTexts) {
    const normalizedPageText = normalizePageText(pageText);
    if (!normalizedPageText) continue;
    if (!rawText) {
      rawText = normalizedPageText;
      continue;
    }
    if (shouldMergeHyphenatedWord(rawText, normalizedPageText)) {
      rawText = rawText.slice(0, -1) + normalizedPageText;
      continue;
    }
    rawText += ` ${normalizedPageText}`;
  }
  return rawText;
}

async function extractRawText(buffer) {
  const pdf = await getDocument({
    data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    useSystemFonts: true,
  }).promise;
  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(extractPageTextFromItems(content.items));
  }
  return joinPagesContinuously(pageTexts);
}

const WHERE = "status = 'completed' AND deleted_at IS NULL";

async function main() {
  if (REMOTE) {
    const required = [
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_D1_DATABASE_ID",
    ];
    const missing = required.filter((k) => !E[k]);
    if (missing.length > 0) {
      throw new Error(
        `Missing ${missing.join(", ")} in .dev.vars (required for --remote; pass --local to run against the local D1/R2 emulation instead)`,
      );
    }
  }

  const flag = REMOTE ? "--remote" : "--local";

  const [{ total }] = await d1Query(`SELECT COUNT(*) AS total FROM papers WHERE ${WHERE}`);
  const papers = await d1Query(
    `SELECT id, pdf_r2_key FROM papers WHERE ${WHERE} ORDER BY created_at${LIMIT > 0 ? ` LIMIT ${LIMIT}` : ""}`,
  );
  const expected = LIMIT > 0 ? Math.min(Number(total), LIMIT) : Number(total);
  if (papers.length !== expected) {
    throw new Error(
      `Row count mismatch: COUNT(*)=${total}${LIMIT > 0 ? `, limit=${LIMIT}` : ""}, but SELECT returned ${papers.length} row(s) (expected ${expected}). Possible truncation — aborting instead of backfilling a partial set.`,
    );
  }
  console.log(`Found ${papers.length} completed papers`);

  let done = 0;
  let skipped = 0;
  let failed = 0;
  const tmp = mkdtempSync(join(tmpdir(), "paper-text-"));
  const probePath = join(tmp, "probe");
  for (const p of papers) {
    const textKey = `paper-text/${p.id}.txt`;
    try {
      if (r2Exists(textKey, probePath)) {
        skipped++;
        continue;
      }
      if (DRY_RUN) {
        console.log(`[dry-run] would backfill ${p.id} from ${p.pdf_r2_key}`);
        done++;
        continue;
      }
      const pdfPath = join(tmp, "cur.pdf");
      wrangler(["r2", "object", "get", `${BUCKET}/${p.pdf_r2_key}`, "--file", pdfPath, flag]);
      const text = await extractRawText(readFileSync(pdfPath));
      if (!text.trim()) throw new Error("extracted text is empty");
      const txtPath = join(tmp, "cur.txt");
      writeFileSync(txtPath, text);
      wrangler(["r2", "object", "put", `${BUCKET}/${textKey}`, "--file", txtPath, "--content-type", "text/plain", flag]);
      done++;
      console.log(`[${done}] ${p.id}: ${text.length} chars`);
    } catch (err) {
      if (err instanceof FatalError) {
        rmSync(tmp, { recursive: true, force: true });
        throw err;
      }
      failed++;
      console.error(`FAILED ${p.id}: ${String(err).slice(0, 200)}`);
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  console.log(`Done. ok=${done} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => {
  console.error("[backfill-text] fatal:", e);
  process.exit(1);
});
