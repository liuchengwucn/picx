#!/usr/bin/env node
/**
 * Re-translate truncated summary translations in paper_results.
 *
 * Before the reasoning/finish_reason fix (src/lib/ai.ts reasoningParam +
 * assertNotTruncated), reasoning tokens could eat the max_tokens budget and
 * translations were silently stored half-written. This script re-translates
 * the affected languages from the intact English summary and merges them back.
 *
 * Input (--targets): the tierA.json produced by the audit, shaped as
 *   { "en_broken": [...], "retranslate": { "<short_id>": ["ja","zh-tw",...] } }
 * Only the `retranslate` field is used — those papers have a healthy
 * summaries.en to translate from.
 *
 * Strategy (mirrors scripts/backfill-tldr.mjs conventions):
 *   - read the paper's summaries JSON from remote D1,
 *   - re-translate summaries.en into each listed language with the SAME
 *     system prompt as translateSummary in src/lib/ai.ts,
 *   - only when ALL listed languages succeed, merge them into the freshest
 *     summaries JSON and UPDATE the row in one statement (single-row single
 *     statement — safe without transactions on D1). A partial failure skips
 *     the whole paper; it is retried on the next run.
 *
 * Safety:
 *   - Resumable: completed short_ids are recorded in a local progress file
 *     (~/.cache/picx-debug/retranslate-progress.json) and skipped on re-runs.
 *   - Per-paper try/catch: a failure never aborts the whole batch.
 *   - `--dry-run` only reads D1 and prints the plan (languages to rewrite,
 *     source/current character counts); NO LLM calls, NO writes.
 *
 * Usage (run via the host so node + .dev.vars are available):
 *   node scripts/repair-truncated-translations.mjs --targets tierA.json
 *       [--dry-run] [--limit N] [--concurrency N] [--only SHORT_ID]
 *
 * Defaults: concurrency 3, no limit. `--only` processes a single short_id
 * and ignores the progress file (for trial runs).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// ---------- args ----------
const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getOpt = (f, def) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const TARGETS_FILE = getOpt("--targets", "");
const DRY_RUN = hasFlag("--dry-run");
const LIMIT = Number(getOpt("--limit", "0")); // 0 = no limit
const CONCURRENCY = Math.max(1, Number(getOpt("--concurrency", "3")));
const ONLY = getOpt("--only", "");

const PROGRESS_FILE = join(
  homedir(),
  ".cache/picx-debug/retranslate-progress.json",
);

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
const OPENAI_API_KEY = E.OPENAI_API_KEY;
const OPENAI_BASE_URL = E.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_MODEL = E.OPENAI_MODEL || "gpt-5.2-instant";
const CF_API_TOKEN = E.CF_API_TOKEN;

const LANGS = ["en", "zh-cn", "zh-tw", "ja"];

// ---------- D1 access (remote only; parameterized queries, so no manual
// single-quote escaping is needed — same approach as backfill-tldr.mjs) ----------
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

// ---------- translation ----------
// System prompt copied VERBATIM from translateSummary in src/lib/ai.ts —
// keep them in sync if that prompt changes.
function translationSystemPrompt(targetLanguage) {
  const languageInstruction =
    targetLanguage === "zh-cn"
      ? "请将以下学术论文摘要翻译成简体中文。"
      : targetLanguage === "zh-tw"
        ? "請將以下學術論文摘要翻譯成繁體中文。"
        : targetLanguage === "ja"
          ? "以下の学術論文の要約を日本語に翻訳してください。"
          : "Please translate the following academic paper summary into English.";

  return `You are an expert translator specializing in academic papers. Translate the given summary while maintaining its structure and formatting.

${languageInstruction}

CRITICAL - Preserve Mathematical Content:
- ALWAYS preserve ALL mathematical formulas, equations, and expressions EXACTLY as they appear
- Keep LaTeX notation unchanged: $inline$ for inline math, $$display$$ for display equations
- Do NOT translate or modify any mathematical symbols, variables, operators, subscripts, superscripts
- Preserve formula numbers and references exactly as they appear
- Mathematical content should remain in its original form - only translate the surrounding text

CRITICAL - Preserve Tables:
- ALWAYS preserve ALL tables EXACTLY as they appear
- Keep Markdown table syntax unchanged
- Only translate table captions and text content within cells
- Preserve column headers, row labels, and numerical values exactly
- Maintain table alignment and structure

CRITICAL - Preserve Markdown Formatting:
- Keep all Markdown syntax (headers ##, lists -, bold **, italic *, code blocks \`\`\`, blockquotes >)
- Preserve code blocks and their syntax highlighting markers
- Maintain the document structure and hierarchy

Guidelines:
- Translate only the natural language text
- Maintain academic tone and terminology
- Keep technical terms accurate
- Preserve all formatting, formulas, tables, and code blocks exactly`;
}

async function translate(summaryText, targetLanguage) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`,
  };
  if (CF_API_TOKEN) headers["cf-aig-authorization"] = `Bearer ${CF_API_TOKEN}`;

  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: translationSystemPrompt(targetLanguage) },
        { role: "user", content: summaryText },
      ],
      temperature: 0.3, // 较低的温度以保持翻译准确性 (same as translateSummary)
      max_tokens: 8000,
      // Reasoning models (e.g. DeepSeek) think by default on OpenRouter and the
      // thinking tokens eat into max_tokens, silently truncating the content —
      // the very bug this script repairs. Disable explicitly — mirrors
      // reasoningParam() in src/lib/ai.ts (only sent to OpenRouter endpoints).
      ...(/openrouter/i.test(OPENAI_BASE_URL)
        ? { reasoning: { enabled: false } }
        : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  // finish_reason=length means the output was cut off by max_tokens — never
  // store it. Mirrors assertNotTruncated() in src/lib/ai.ts.
  if (data.choices?.[0]?.finish_reason === "length") {
    throw new Error(
      `Translation (${targetLanguage}) truncated (finish_reason=length)`,
    );
  }
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`Empty translation (${targetLanguage})`);
  return text;
}

// ---------- progress file ----------
function loadProgress() {
  if (!existsSync(PROGRESS_FILE)) return new Set();
  try {
    const arr = JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    console.warn(`[repair] unreadable progress file ${PROGRESS_FILE}, ignoring`);
    return new Set();
  }
}

function saveProgress(done) {
  mkdirSync(dirname(PROGRESS_FILE), { recursive: true });
  writeFileSync(PROGRESS_FILE, `${JSON.stringify([...done].sort(), null, 1)}\n`);
}

// ---------- concurrency pool ----------
async function pool(items, worker, concurrency) {
  let idx = 0;
  const results = [];
  async function run() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, run),
  );
  return results;
}

// ---------- main ----------
async function main() {
  if (!ACCOUNT_ID || !API_TOKEN || !DB_ID) {
    throw new Error("Missing CLOUDFLARE_* credentials in .dev.vars");
  }
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY in .dev.vars");
  if (!TARGETS_FILE) {
    throw new Error("--targets <tierA.json> is required");
  }

  const targets = JSON.parse(readFileSync(TARGETS_FILE, "utf8"));
  const retranslate = targets.retranslate;
  if (!retranslate || typeof retranslate !== "object") {
    throw new Error(`--targets file has no "retranslate" object`);
  }

  const done = loadProgress();
  let entries = Object.entries(retranslate).map(([shortId, langs]) => {
    // Guard the language list: only known langs, and never "en" (en is the
    // intact source these papers are re-translated from).
    const clean = (Array.isArray(langs) ? langs : []).filter(
      (l) => LANGS.includes(l) && l !== "en",
    );
    if (clean.length !== (Array.isArray(langs) ? langs.length : 0)) {
      console.warn(`  - ${shortId}: dropped unexpected language(s) from list`);
    }
    return [shortId, clean];
  });
  entries = entries.filter(([, langs]) => langs.length > 0);

  if (ONLY) {
    // --only ignores the progress file so a single paper can be re-run.
    entries = entries.filter(([shortId]) => shortId === ONLY);
    if (entries.length === 0) {
      throw new Error(`--only ${ONLY}: not present in retranslate targets`);
    }
  } else {
    const before = entries.length;
    entries = entries.filter(([shortId]) => !done.has(shortId));
    if (before !== entries.length) {
      console.log(
        `[repair] ${before - entries.length} paper(s) already done (progress file), skipping.`,
      );
    }
  }
  if (LIMIT) entries = entries.slice(0, LIMIT);

  console.log(
    `[repair] ${entries.length} paper(s) to process.${DRY_RUN ? " (DRY RUN — no LLM calls, no writes)" : ""}`,
  );
  console.log(
    `[repair] concurrency=${CONCURRENCY}${LIMIT ? ` limit=${LIMIT}` : ""}${ONLY ? ` only=${ONLY}` : ""}`,
  );

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  await pool(
    entries,
    async ([shortId, langs]) => {
      processed++;
      try {
        const rows = await d1Remote(
          `SELECT pr.id, pr.summaries FROM paper_results pr
             JOIN papers p ON p.id = pr.paper_id
            WHERE p.short_id = ?`,
          [shortId],
        );
        if (rows.length === 0) {
          skipped++;
          console.warn(`  - ${shortId}: no paper_results row found, skipped`);
          return;
        }
        const row = rows[0];
        let summaries;
        try {
          summaries =
            typeof row.summaries === "string"
              ? JSON.parse(row.summaries)
              : row.summaries;
        } catch (e) {
          failed++;
          console.warn(`  ✗ ${shortId}: bad summaries JSON (${e.message})`);
          return;
        }
        const en = summaries?.en?.trim();
        if (!en) {
          skipped++;
          console.warn(`  - ${shortId}: summaries.en missing/empty, skipped`);
          return;
        }

        if (DRY_RUN) {
          const plan = langs
            .map((l) => `${l}(now ${summaries[l]?.length ?? 0} chars)`)
            .join(", ");
          console.log(
            `  • ${shortId}: would re-translate [${plan}] from en (${en.length} chars)`,
          );
          updated++;
          return;
        }

        // Translate ALL listed languages first; any failure throws and the
        // whole paper is skipped (nothing written, retried next run).
        const translations = await Promise.all(
          langs.map((l) => translate(en, l)),
        );

        // Merge into the freshest copy of the row and write once. Single-row
        // single-statement UPDATE — safe without transactions on D1.
        const freshRows = await d1Remote(
          "SELECT summaries FROM paper_results WHERE id = ?",
          [row.id],
        );
        const fresh =
          typeof freshRows[0].summaries === "string"
            ? JSON.parse(freshRows[0].summaries)
            : freshRows[0].summaries;
        langs.forEach((l, i) => {
          fresh[l] = translations[i];
        });
        await d1Remote("UPDATE paper_results SET summaries = ? WHERE id = ?", [
          JSON.stringify(fresh),
          row.id,
        ]);

        updated++;
        done.add(shortId);
        saveProgress(done);
        console.log(
          `  ✓ ${shortId}: rewrote [${langs.map((l, i) => `${l}(${translations[i].length} chars)`).join(", ")}]`,
        );
      } catch (e) {
        failed++;
        console.warn(`  ✗ ${shortId}: ${e.message}`);
      }
    },
    CONCURRENCY,
  );

  console.log(
    `[repair] done. processed=${processed} updated=${updated} skipped=${skipped} failed=${failed}`,
  );
}

main().catch((e) => {
  console.error("[repair] fatal:", e);
  process.exit(1);
});
