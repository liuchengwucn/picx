#!/usr/bin/env node
/**
 * Backfill `categories` + `tags` for existing paper_results rows.
 *
 * Existing rows have categories/tags = NULL. This script classifies each via
 * the same LLM call the pipeline uses, derived from the English summary
 * (fallback: any present language).
 *
 * Safety: idempotent & resumable (only rows where categories IS NULL),
 * per-paper try/catch, --dry-run support. Mirror of scripts/backfill-tldr.mjs.
 *
 * Usage:
 *   node scripts/backfill-categories.mjs [--remote] [--dry-run]
 *                                        [--limit N] [--batch N] [--concurrency N]
 *   Defaults: --remote, batch 10, concurrency 3, no limit.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getOpt = (f, def) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DRY_RUN = hasFlag("--dry-run");
// --retry-failed: 重跑「分类调用失败被静默钉成 other」的行(categories=["other"]
// 且 tags 为空),而非默认的 categories IS NULL 行。
const RETRY_FAILED = hasFlag("--retry-failed");
const LIMIT = Number(getOpt("--limit", "0"));
const BATCH = Math.max(1, Number(getOpt("--batch", "10")));
const CONCURRENCY = Math.max(1, Number(getOpt("--concurrency", "3")));

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

// 必须与 src/lib/paper-categories.ts 保持一致。
const CATEGORY_SLUGS = [
  "llm", "nlp", "multimodal", "vision", "generative", "speech-audio",
  "reinforcement-learning", "agents", "reasoning-planning", "retrieval-rag",
  "robotics-3d", "ml-theory", "efficiency", "data-benchmark",
  "alignment-safety", "ai-for-science", "other",
];
const SLUG_SET = new Set(CATEGORY_SLUGS);
const LANGS = ["en", "zh-cn", "zh-tw", "ja"];

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

async function classify(text) {
  const systemPrompt = `You are an expert at classifying AI/ML research papers.

Pick 1-3 PRIMARY categories from this EXACT fixed list (use the slug verbatim):
${CATEGORY_SLUGS.join(", ")}

Then produce 3-5 free-form fine-grained TAGS (lowercase, hyphenated).

Rules:
- Categories MUST be slugs from the list above. If nothing fits, use ["other"].
- Output ONLY a JSON object, no prose, no code fences:
{"categories":["..."],"tags":["..."]}`;
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
        { role: "user", content: text.slice(0, 3500) },
      ],
      temperature: 0.2,
      max_tokens: 400, // 200 偏紧:分类+3-5 tag 的 JSON 偶尔被截断成无法解析
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  return parseClassification(content);
}

function parseClassification(content) {
  try {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end < 0) return { categories: ["other"], tags: [] };
    const parsed = JSON.parse(content.slice(start, end + 1));
    const cats = (Array.isArray(parsed.categories) ? parsed.categories : [])
      .filter((s) => typeof s === "string" && SLUG_SET.has(s))
      .filter((s, i, a) => a.indexOf(s) === i)
      .slice(0, 3);
    const tags = (Array.isArray(parsed.tags) ? parsed.tags : [])
      .filter((s) => typeof s === "string")
      .map((s) =>
        s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
          .replace(/-+/g, "-").replace(/^-|-$/g, ""),
      )
      .filter((s) => s.length > 0)
      .filter((s, i, a) => a.indexOf(s) === i)
      .slice(0, 6);
    return { categories: cats.length ? cats : ["other"], tags };
  } catch {
    return { categories: ["other"], tags: [] };
  }
}

// 分类带重试:把「other + 空 tags」当作失败(正常分类必带 tag),指数退避重试。
async function classifyWithRetry(text, retries = 3) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await classify(text);
      if (
        r.tags.length === 0 &&
        r.categories.length === 1 &&
        r.categories[0] === "other"
      ) {
        throw new Error("empty/garbled classification");
      }
      return r;
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        await new Promise((res) => setTimeout(res, 500 * 2 ** i));
      }
    }
  }
  throw lastErr;
}

// 处理单行:解析 summaries → 选文本 → 重试分类(耗尽兜底 other)→ 写回。
// 返回 "updated" | "skipped" | "failed"。
async function reclassifyRow(row) {
  let summaries;
  try {
    summaries =
      typeof row.summaries === "string"
        ? JSON.parse(row.summaries)
        : row.summaries;
  } catch (e) {
    console.warn(`  ✗ ${row.id}: bad summaries JSON (${e.message})`);
    return "failed";
  }
  const text = pickText(summaries, row.summaryLanguage);
  if (!text) {
    console.warn(`  - ${row.id}: no usable summary, skipped`);
    return "skipped";
  }
  let categories;
  let tags;
  try {
    ({ categories, tags } = await classifyWithRetry(text));
  } catch {
    // 重试耗尽:兜底 ["other"](与产线一致)。
    categories = ["other"];
    tags = [];
  }
  try {
    if (DRY_RUN) {
      console.log(
        `  • ${row.id}: cats=[${categories.join(",")}] tags=[${tags.join(",")}]`,
      );
      return "updated";
    }
    await d1Remote(
      "UPDATE paper_results SET categories = ?, tags = ? WHERE id = ?",
      [JSON.stringify(categories), JSON.stringify(tags), row.id],
    );
    console.log(`  ✓ ${row.id}: [${categories.join(",")}]`);
    return "updated";
  } catch (e) {
    console.warn(`  ✗ ${row.id}: ${e.message}`);
    return "failed";
  }
}

function pickText(summaries, summaryLanguage) {
  const present = LANGS.filter((l) => summaries[l]?.trim());
  if (present.length === 0) return null;
  const base = present.includes("en")
    ? "en"
    : present.includes(summaryLanguage)
      ? summaryLanguage
      : present[0];
  return summaries[base];
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

async function main() {
  if (!ACCOUNT_ID || !API_TOKEN || !DB_ID) {
    throw new Error("Missing CLOUDFLARE_* credentials in .dev.vars");
  }
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY in .dev.vars");

  // --retry-failed:一次性取出「失败特征」行(categories=["other"] 且 tags 为空)重跑。
  // 不走 NULL 的批量重查循环 —— 持续失败的行重写后仍匹配,会导致死循环。
  if (RETRY_FAILED) {
    const rows = await d1Remote(
      `SELECT id, summaries, summary_language AS summaryLanguage
       FROM paper_results
       WHERE categories = '["other"]' AND (tags = '[]' OR tags IS NULL)
       ${LIMIT ? `LIMIT ${LIMIT}` : ""}`,
    );
    console.log(
      `[backfill-cat] retry-failed: ${rows.length} row(s) match failure signature.${DRY_RUN ? " (DRY RUN)" : ""}`,
    );
    let updated = 0, failed = 0, skipped = 0;
    await pool(
      rows,
      async (row) => {
        const r = await reclassifyRow(row);
        if (r === "updated") updated++;
        else if (r === "failed") failed++;
        else skipped++;
      },
      CONCURRENCY,
    );
    console.log(
      `[backfill-cat] done. processed=${rows.length} updated=${updated} failed=${failed} skipped=${skipped}`,
    );
    return;
  }

  const [{ total }] = await d1Remote(
    "SELECT count(*) AS total FROM paper_results WHERE categories IS NULL",
  );
  console.log(
    `[backfill-cat] ${total} row(s) missing categories.${DRY_RUN ? " (DRY RUN)" : ""}`,
  );

  let processed = 0, updated = 0, failed = 0;
  while (true) {
    if (LIMIT && processed >= LIMIT) break;
    const take = LIMIT ? Math.min(BATCH, LIMIT - processed) : BATCH;
    const rows = await d1Remote(
      "SELECT id, summaries, summary_language AS summaryLanguage FROM paper_results WHERE categories IS NULL LIMIT ?",
      [take],
    );
    if (rows.length === 0) break;

    await pool(
      rows,
      async (row) => {
        processed++;
        const r = await reclassifyRow(row);
        if (r === "updated") updated++;
        else if (r === "failed") failed++;
      },
      CONCURRENCY,
    );

    if (DRY_RUN && !LIMIT) break;
  }
  console.log(
    `[backfill-cat] done. processed=${processed} updated=${updated} failed=${failed}`,
  );
}

main().catch((e) => {
  console.error("[backfill-cat] fatal:", e);
  process.exit(1);
});
