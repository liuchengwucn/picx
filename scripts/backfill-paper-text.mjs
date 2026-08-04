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
 *   - Per-paper try/catch: one failure never aborts the batch.
 *   - --dry-run lists what would be done without writing.
 *
 * Usage (run on the host):
 *   node scripts/backfill-paper-text.mjs [--dry-run] [--limit N] [--local]
 *
 * Defaults: remote bucket, no limit.
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
// bucket_name for the PAPERS_BUCKET binding, per wrangler.jsonc.
const BUCKET = "picx-papers-apac";

async function d1Query(sql) {
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
  if (!json.success) throw new Error(JSON.stringify(json.errors));
  return json.result[0].results;
}

function wrangler(cmd) {
  return execFileSync("npx", ["wrangler", ...cmd], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// `--file /dev/null` does not work here: when this script is invoked via the
// `mac` host bridge, absolute paths get VM-prefix-translated and /dev/null
// no longer resolves to a real device on the target side (confirmed by
// manual testing: wrangler throws EACCES trying to open the translated
// path). Use a real scratch file instead.
function r2Exists(key, probePath) {
  const flag = REMOTE ? "--remote" : "--local";
  try {
    wrangler(["r2", "object", "get", `${BUCKET}/${key}`, "--file", probePath, flag]);
    return true;
  } catch {
    return false;
  }
}

// ---- page-text extraction, mirrors src/lib/pdf.ts (kept in sync) ----
function normalizePageText(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v 　]+/g, " ")
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

const flag = REMOTE ? "--remote" : "--local";
const papers = await d1Query(
  `SELECT id, pdf_r2_key FROM papers WHERE status = 'completed' AND deleted_at IS NULL ORDER BY created_at${LIMIT > 0 ? ` LIMIT ${LIMIT}` : ""}`,
);
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
    failed++;
    console.error(`FAILED ${p.id}: ${String(err).slice(0, 200)}`);
  }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`Done. ok=${done} skipped=${skipped} failed=${failed}`);
