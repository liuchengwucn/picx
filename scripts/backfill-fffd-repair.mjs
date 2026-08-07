#!/usr/bin/env node
/**
 * Repair U+FFFD (�) characters in the MinerU markdown already sitting in R2
 * (`paper-content/{id}/full.md`) by aligning each � against the original PDF's
 * text layer (repairFffd, see src/lib/mineru-fffd.ts).
 *
 * Why: MinerU corrupts some astral math characters (𝑘 U+1D458, ...) into
 * U+FFFD — the information is gone from the markdown, but the PDF text layer
 * still has it. The online pipeline now repairs at parse time
 * (queue-consumer persistMineruContent); this script backfills the papers
 * persisted before that. No MinerU calls, no LLM, no credits, no writes to
 * `papers`, and `paper-content/{id}/images/` is never touched.
 *
 * Candidates come from a scan file (--candidates, required): JSON array whose
 * elements carry an id (`paper_id` or `id`) and a `fffd` count (format of
 * .scan-tmp/affected.json); only entries with fffd > 0 are considered, and the
 * current full.md is re-checked for � before doing anything (papers re-parsed
 * since the scan are skipped naturally).
 *
 * Per changed paper, writes happen in a deliberate order so an interrupted run
 * is safe to re-run:
 *   1. `paper-text/{id}.txt`  — markdownToPlainText(repaired), same derivation
 *      as queue-consumer,
 *   2. `paper_contents.char_count` — repaired.length,
 *   3. `paper-content/{id}/full.md` — repaired markdown, written LAST as the
 *      "this paper is done" marker: repairFffd is idempotent, so on a re-run a
 *      finished paper reads back its repaired full.md, repairs zero runs and is
 *      skipped; an unfinished paper is fully redone and the derived overwrites
 *      are harmless.
 *
 * Defensive image-ref check: by construction repairFffd only replaces �-runs
 * with non-ASCII characters and cannot alter image references, but before
 * writing anything the `![...](...)` sequence of original and repaired
 * markdown is compared; a mismatch marks the paper failed and skips all writes
 * for it.
 *
 * Safety:
 *   - Idempotent & resumable (see write order above).
 *   - Per-paper try/catch: a failure is recorded and skipped, never aborts the
 *     batch; failed ids are listed at the end (re-run to retry).
 *   - pdf_r2_key is resolved via one full-table SELECT into memory (papers is
 *     small), sidestepping D1's 100-bound-parameter limit.
 *   - `--dry-run` reads, extracts and repairs but writes nothing; reports what
 *     would change with repair counts, byte delta and image-ref check result.
 *
 * Usage (run on the host):
 *   npm run db:backfill-fffd-repair -- --candidates <path> [--dry-run]
 *                                      [--limit N] [--only <paperId>] [--local]
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

import { repairFffd } from "../src/lib/mineru-fffd.ts";
import { markdownToPlainText, paperContentMarkdownKey } from "../src/lib/paper-content.ts";
import { paperTextKey } from "../src/lib/paper-text.ts";
import { extractPDFText } from "../src/lib/pdf.ts";

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
  console.error(`[fffd-repair] invalid --limit value: ${getOpt("--limit", "0")}`);
  process.exit(1);
}
const ONLY = getOpt("--only", "");
const CANDIDATES_PATH = getOpt("--candidates", "");
if (!CANDIDATES_PATH) {
  console.error(
    "[fffd-repair] --candidates <path> is required (JSON array with paper_id/id + fffd fields, e.g. .scan-tmp/affected.json)",
  );
  process.exit(1);
}
const R2_ATTEMPTS = 3;
// Backfill runs offline with no Workers CPU budget — much laxer than the
// online PDFJS_MAX_PAGES=150 so long papers still get their text layer.
const PDF_MAX_PAGES = 1000;

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
    maxBuffer: 256 * 1024 * 1024,
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

function imageRefsMatch(original, repaired) {
  const a = original.match(IMAGE_REF_RE) ?? [];
  const b = repaired.match(IMAGE_REF_RE) ?? [];
  if (a.length !== b.length) return false;
  return a.every((ref, i) => ref === b[i]);
}

// ---------- helpers ----------
const FFFD_RUN_RE = /�+/g;

async function r2GetText(name, key, path) {
  // Remove any leftover from the previous paper so a silently-failed get can
  // never make this paper read the previous paper's file.
  rmSync(path, { force: true });
  await r2(name, ["r2", "object", "get", `${BUCKET}/${key}`, "--file", path, R2_FLAG]);
  return readFileSync(path, "utf8");
}

/** 下载 PDF 并抽文本层（不传 aiConfig：不做 AI 裁尾，只要 rawText）。 */
async function extractPdfTextLayer(pdfKey, tmp) {
  const pdfPath = join(tmp, "paper.pdf");
  rmSync(pdfPath, { force: true });
  await r2(`r2 get pdf`, [
    "r2", "object", "get",
    `${BUCKET}/${pdfKey}`,
    "--file", pdfPath, R2_FLAG,
  ]);
  const buf = readFileSync(pdfPath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return (await extractPDFText(arrayBuffer, PDF_MAX_PAGES)).rawText;
}

// ---------- per-paper ----------
async function repairOne(paperId, pdfKeyById, tmp) {
  const markdown = await r2GetText(
    `r2 get md ${paperId}`,
    paperContentMarkdownKey(paperId),
    join(tmp, "full.md"),
  );

  // 上一轮回填/重新解析后的现实校验：full.md 已无 � 就没活可干。
  if (!markdown.includes("�")) {
    return { outcome: "skipped", reason: "no U+FFFD in current full.md" };
  }

  const pdfKey = pdfKeyById.get(paperId);
  if (!pdfKey) {
    throw new Error("no pdf_r2_key found in papers (deleted or missing row)");
  }

  const pdfText = await extractPdfTextLayer(pdfKey, tmp);
  const result = repairFffd(markdown, pdfText);

  if (result.repaired === 0) {
    return { outcome: "skipped", reason: `0/${result.total} runs repairable`, total: result.total, repaired: 0 };
  }
  if (!imageRefsMatch(markdown, result.markdown)) {
    throw new Error("image reference sequence changed by repair — refusing to write");
  }

  const remaining = (result.markdown.match(FFFD_RUN_RE) ?? []).length;
  const byteDelta = Buffer.byteLength(result.markdown) - Buffer.byteLength(markdown);
  const stats = { total: result.total, repaired: result.repaired, remaining, byteDelta };

  if (DRY_RUN) {
    return { outcome: "repaired", ...stats };
  }

  // 1. plain text (chatbot's readPaper source), same derivation as queue-consumer.
  const plainText = markdownToPlainText(result.markdown);
  if (plainText.trim().length === 0) {
    throw new Error("repaired markdown produced empty plain text");
  }
  const txtPath = join(tmp, "text.txt");
  writeFileSync(txtPath, plainText);
  await r2(`r2 put text ${paperId}`, [
    "r2", "object", "put",
    `${BUCKET}/${paperTextKey(paperId)}`,
    "--file", txtPath,
    "--content-type", "text/plain; charset=utf-8",
    R2_FLAG,
  ]);

  // 2. char_count follows the markdown that is about to be written.
  await d1("UPDATE paper_contents SET char_count = ? WHERE paper_id = ?", [
    result.markdown.length,
    paperId,
  ]);

  // 3. full.md LAST — the completion marker (see header).
  const mdOutPath = join(tmp, "full-repaired.md");
  writeFileSync(mdOutPath, result.markdown);
  await r2(`r2 put md ${paperId}`, [
    "r2", "object", "put",
    `${BUCKET}/${paperContentMarkdownKey(paperId)}`,
    "--file", mdOutPath,
    "--content-type", "text/markdown; charset=utf-8",
    R2_FLAG,
  ]);

  return { outcome: "repaired", ...stats };
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

  // 候选清单：扫描产物 JSON，元素含 paper_id（或 id）与 fffd。
  const rawCandidates = JSON.parse(readFileSync(CANDIDATES_PATH, "utf8"));
  if (!Array.isArray(rawCandidates)) {
    throw new Error(`--candidates file is not a JSON array: ${CANDIDATES_PATH}`);
  }
  let candidates = rawCandidates
    .map((c) => ({ id: c.paper_id ?? c.id, fffd: Number(c.fffd ?? 0) }))
    .filter((c) => typeof c.id === "string" && c.id.length > 0 && c.fffd > 0);
  if (ONLY) {
    candidates = candidates.filter((c) => c.id === ONLY);
    if (candidates.length === 0) {
      throw new Error(`--only ${ONLY} not found among fffd>0 candidates in ${CANDIDATES_PATH}`);
    }
  }
  if (LIMIT > 0) {
    candidates = candidates.slice(0, LIMIT);
  }

  // 一次性拉全量 id → pdf_r2_key 映射进内存：绕开 D1 单查询 100 绑定参数
  // 上限（别用大 IN 列表），带行数守卫防 API 静默截断。
  const [{ total: paperCount }] = await d1(
    "SELECT COUNT(*) AS total FROM papers WHERE deleted_at IS NULL",
  );
  const paperRows = await d1(
    "SELECT id, pdf_r2_key FROM papers WHERE deleted_at IS NULL",
  );
  if (paperRows.length !== Number(paperCount)) {
    throw new Error(
      `Row count mismatch loading papers: COUNT(*)=${paperCount} but SELECT returned ${paperRows.length} row(s). Possible truncation — aborting.`,
    );
  }
  const pdfKeyById = new Map(paperRows.map((r) => [r.id, r.pdf_r2_key]));

  console.log(
    `[fffd-repair] mode=${REMOTE ? "remote" : "local"} candidates=${candidates.length} (fffd>0${ONLY ? `, only=${ONLY}` : ""}${LIMIT > 0 ? `, limit=${LIMIT}` : ""}), ${paperRows.length} papers in pdf-key map${DRY_RUN ? " (DRY RUN — no writes)" : ""}`,
  );

  const tmp = mkdtempSync(join(tmpdir(), "fffd-repair-"));
  const runStart = Date.now();
  const repairedPapers = [];
  const skipped = [];
  const failures = [];
  let runTotal = 0;
  let runRepaired = 0;

  for (const [idx, c] of candidates.entries()) {
    const label = `[${idx + 1}/${candidates.length}] ${c.id}`;
    const start = Date.now();
    try {
      const r = await repairOne(c.id, pdfKeyById, tmp);
      runTotal += r.total ?? 0;
      runRepaired += r.repaired ?? 0;
      if (r.outcome === "skipped") {
        skipped.push(c.id);
        console.log(`- ${label} skipped (${r.reason}) in ${fmtDuration(Date.now() - start)}`);
      } else {
        repairedPapers.push(c.id);
        const delta = r.byteDelta >= 0 ? `+${r.byteDelta}` : `${r.byteDelta}`;
        console.log(
          `${DRY_RUN ? "~" : "✓"} ${label} ${DRY_RUN ? "would repair" : "repaired"} ${r.repaired}/${r.total} run(s), ${r.remaining} remaining (${delta}B, image refs OK) in ${fmtDuration(Date.now() - start)}`,
        );
      }
    } catch (err) {
      failures.push({ id: c.id, error: String(err?.message ?? err).slice(0, 300) });
      console.error(
        `✗ ${label} failed after ${fmtDuration(Date.now() - start)}: ${String(err?.message ?? err).slice(0, 300)}`,
      );
    }
  }

  rmSync(tmp, { recursive: true, force: true });

  console.log("");
  console.log(
    `[fffd-repair] ${DRY_RUN ? "dry run " : ""}done in ${fmtDuration(Date.now() - runStart)}. scanned=${candidates.length} repaired-papers=${repairedPapers.length} skipped=${skipped.length} failed=${failures.length} | runs: total=${runTotal} repaired=${runRepaired}`,
  );
  if (failures.length > 0) {
    console.log("[fffd-repair] failed ids (nothing written for these; re-run to retry):");
    for (const f of failures) console.log(`  ${f.id}: ${f.error}`);
  }
}

main().catch((e) => {
  console.error("[fffd-repair] fatal:", e);
  process.exit(1);
});
