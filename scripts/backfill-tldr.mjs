#!/usr/bin/env node
/**
 * Backfill multilingual `tldr` for existing paper_results rows.
 *
 * Existing rows (created before the tldr feature) have `tldr` = NULL and fall
 * back to a summary-extracted snippet on the gallery. This script upgrades them
 * to a proper, dedicated multilingual tldr derived from their existing
 * summaries — matching what the generation pipeline now produces going forward.
 *
 * Strategy (cost-conscious, mirrors queue-consumer):
 *   - pick the base language (summary_language, fallback en),
 *   - generate ONE tldr sentence from that language's summary,
 *   - translate that short sentence into the other languages present in
 *     `summaries` (cheap, tiny inputs).
 *
 * Safety:
 *   - Idempotent & resumable: only touches rows where `tldr IS NULL`.
 *   - Per-paper try/catch: a failure leaves that row NULL (retried next run),
 *     never aborts the whole batch.
 *   - `--dry-run` prints what would be written without modifying the DB.
 *
 * The prompts here intentionally mirror generateTldr / translateTldr in
 * src/lib/ai.ts — keep them in sync if those change.
 *
 * Usage (run via the host so npm/node + .dev.vars are available):
 *   node scripts/backfill-tldr.mjs [--remote|--local] [--dry-run]
 *                                  [--limit N] [--batch N] [--concurrency N]
 *
 * Defaults: --remote, batch 10, concurrency 3, no limit.
 */

import { readFileSync } from "node:fs";
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
const REMOTE = !hasFlag("--local");
const DRY_RUN = hasFlag("--dry-run");
const LIMIT = Number(getOpt("--limit", "0")); // 0 = no limit
const BATCH = Math.max(1, Number(getOpt("--batch", "10")));
const CONCURRENCY = Math.max(1, Number(getOpt("--concurrency", "3")));

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

function languageDisplayName(language) {
  switch (language) {
    case "zh-cn":
      return "Simplified Chinese (简体中文)";
    case "zh-tw":
      return "Traditional Chinese (繁體中文)";
    case "ja":
      return "Japanese (日本語)";
    default:
      return "English";
  }
}

// ---------- D1 access ----------
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

// Local D1 via wrangler CLI (JSON output).
import { execFileSync } from "node:child_process";
function d1Local(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", "--local", "--json", "--command", sql],
    { cwd: projectRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  // wrangler --json prints an array of {results,...}
  const parsed = JSON.parse(out);
  return parsed[0].results;
}

async function dbQuery(sql, params = []) {
  if (REMOTE) return d1Remote(sql, params);
  // local path only used for read queries without params in this script
  return d1Local(sql);
}

// ---------- OpenAI ----------
async function openai(systemPrompt, userContent, { temperature, maxTokens }) {
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
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty OpenAI response");
  return text;
}

function genTldr(summaryText, language) {
  const sys = `You are an expert at distilling academic papers into a single punchy takeaway.

Given a paper's content, output ONE sentence (maximum 30 words) that captures its single most important contribution or finding — the kind of one-liner a researcher would use to decide whether to read further.

Respond in ${languageDisplayName(language)}.

STRICT OUTPUT RULES:
- Output ONLY the sentence, nothing else (no preamble, no quotes, no label).
- Plain text only: NO Markdown, NO LaTeX, NO math symbols, NO bullet points, NO citations.
- Lead with the result/contribution, not background.
- Keep technical terms and named methods, but stay concise and readable.`;
  // Truncate: the Overview / key contributions sit at the top of the summary,
  // so the head is enough and keeps input cost down.
  return openai(sys, summaryText.slice(0, 3500), {
    temperature: 0.5,
    maxTokens: 200,
  });
}

function transTldr(tldrText, targetLanguage) {
  const sys = `You are an expert academic translator. Translate the given one-sentence research takeaway into ${languageDisplayName(targetLanguage)}.

STRICT OUTPUT RULES:
- Output ONLY the translated sentence, nothing else.
- Plain text only: NO Markdown, NO LaTeX, NO added quotes.
- Keep technical terms and named methods accurate.
- Preserve the concise, single-sentence form.`;
  return openai(sys, tldrText, { temperature: 0.3, maxTokens: 200 });
}

// ---------- per-paper ----------
async function buildTldr(summaries, summaryLanguage) {
  const present = LANGS.filter((l) => summaries[l]?.trim());
  if (present.length === 0) return null;

  const base = present.includes(summaryLanguage)
    ? summaryLanguage
    : present.includes("en")
      ? "en"
      : present[0];

  const tldr = {};
  tldr[base] = await genTldr(summaries[base], base);

  const others = present.filter((l) => l !== base);
  const translations = await Promise.all(
    others.map((l) => transTldr(tldr[base], l)),
  );
  others.forEach((l, i) => {
    tldr[l] = translations[i];
  });
  return tldr;
}

// ---------- batch fetch (remote) ----------
async function fetchBatchRemote(size) {
  // Only rows still missing tldr → naturally resumable as we fill them in.
  return d1Remote(
    "SELECT id, summaries, summary_language AS summaryLanguage FROM paper_results WHERE tldr IS NULL LIMIT ?",
    [size],
  );
}

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
  if (!REMOTE) {
    throw new Error(
      "--local backfill is not supported (no OpenAI run against local rows); use --remote.",
    );
  }

  const [{ total }] = await d1Remote(
    "SELECT count(*) AS total FROM paper_results WHERE tldr IS NULL",
  );
  console.log(
    `[backfill] ${total} row(s) missing tldr.${DRY_RUN ? " (DRY RUN)" : ""}`,
  );
  console.log(
    `[backfill] mode=remote batch=${BATCH} concurrency=${CONCURRENCY}${LIMIT ? ` limit=${LIMIT}` : ""}`,
  );

  let processed = 0;
  let updated = 0;
  let failed = 0;

  while (true) {
    if (LIMIT && processed >= LIMIT) break;
    const take = LIMIT ? Math.min(BATCH, LIMIT - processed) : BATCH;
    const rows = await fetchBatchRemote(take);
    if (rows.length === 0) break;

    await pool(
      rows,
      async (row) => {
        processed++;
        let summaries;
        try {
          summaries =
            typeof row.summaries === "string"
              ? JSON.parse(row.summaries)
              : row.summaries;
        } catch (e) {
          failed++;
          console.warn(`  ✗ ${row.id}: bad summaries JSON (${e.message})`);
          return;
        }
        try {
          const tldr = await buildTldr(summaries, row.summaryLanguage);
          if (!tldr) {
            console.warn(`  - ${row.id}: no usable summary, skipped`);
            return;
          }
          if (DRY_RUN) {
            const preview = tldr[Object.keys(tldr)[0]];
            console.log(
              `  • ${row.id}: [${Object.keys(tldr).join(",")}] ${preview}`,
            );
            updated++;
            return;
          }
          await d1Remote("UPDATE paper_results SET tldr = ? WHERE id = ?", [
            JSON.stringify(tldr),
            row.id,
          ]);
          updated++;
          console.log(
            `  ✓ ${row.id}: tldr set [${Object.keys(tldr).join(",")}]`,
          );
        } catch (e) {
          failed++;
          console.warn(`  ✗ ${row.id}: ${e.message}`);
        }
      },
      CONCURRENCY,
    );

    // In dry-run we never clear the NULLs, so stop after one batch/limit to
    // avoid looping forever on the same rows.
    if (DRY_RUN && !LIMIT) break;
  }

  console.log(
    `[backfill] done. processed=${processed} updated=${updated} failed=${failed}`,
  );
}

main().catch((e) => {
  console.error("[backfill] fatal:", e);
  process.exit(1);
});
