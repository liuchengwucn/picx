#!/usr/bin/env node
/**
 * Re-run the full text-processing chain (summary → translations → tldr, and
 * for failed papers also categories/tags) from the raw paper text stored in R2.
 *
 * Before the reasoning/finish_reason fix (src/lib/ai.ts reasoningParam +
 * assertNotTruncated, commit 4825042), reasoning tokens could eat the
 * max_tokens budget and outputs were silently truncated or empty. Two groups
 * of papers need a full redo from the source text:
 *
 * Mode A (--targets tierA.json → `en_broken` array): papers that are
 *   status=completed but whose summaries.en is truncated (so every translation
 *   was made from a broken source too). We regenerate the base summary from
 *   the R2 full text, re-translate, regenerate tldr, and UPDATE only the
 *   `summaries` + `tldr` columns of the existing paper_results row
 *   (categories/tags/whiteboardInsights/summaryLanguage keep their old
 *   values). The papers row is untouched (already completed).
 *
 * Mode B (--failed): papers with status='failed' whose error happened AFTER
 *   text extraction (error_message mentions translate-summary /
 *   generate-summary / generate-whiteboard), so the full text is already in
 *   R2. We regenerate summaries + tldr + categories/tags, DELETE any existing
 *   paper_results row for the paper and INSERT a fresh one (mirrors the
 *   idempotent cleanup in src/workers/queue-consumer.ts before its insert),
 *   then flip the papers row to completed. whiteboardInsights stays NULL —
 *   whiteboards are opt-in now and are NOT generated here. Credits and
 *   gallery flags (isPublic/isListedInGallery/publishedAt) are not touched.
 *
 *   Write order is paper_results FIRST, papers.status LAST: status is the
 *   consumer-side idempotency guard, so a crash window must never leave a
 *   "completed" paper without results.
 *
 * Source text: R2 object `paper-text/${paper.id}.txt` (see
 * src/lib/paper-text.ts) in bucket picx-papers-apac, fetched via
 * `npx wrangler r2 object get --remote --file <tmp>` (--file avoids the
 * "Proxy environment variables detected" line polluting stdout). The stored
 * text is the UNTRIMMED rawText (references included); instead of replaying
 * the pipeline's LLM tail-trim we truncate to 80k chars, mirroring
 * INSIGHTS_BACKFILL_MAX_CHARS in src/workers/queue-consumer.ts (80k chars ≈
 * 20k tokens, covers virtually every paper body). Papers whose text object is
 * missing (storing it was non-fatal back then) are skipped and reported.
 *
 * Languages: base = the row's summary_language for mode A (failed papers have
 * no results row → "en"); translation targets are the full en/zh-cn/zh-tw/ja
 * set minus the base — equal to the fixed ["zh-cn","zh-tw","ja"] extra set the
 * arxiv cron uses for en-based papers, plus a fresh en translation for the
 * rare non-en-based mode-A paper (see LANGS comment).
 *
 * LLM conventions (mirrors scripts/repair-truncated-translations.mjs):
 * reasoning disabled on OpenRouter endpoints, finish_reason=length → error,
 * empty content → error, exponential backoff retry on 429/5xx. The tldr is
 * non-critical (mirrors queue-consumer): if the base tldr fails after
 * retries, the whole tldr is abandoned (mode A keeps the old value, mode B
 * stores NULL) and the summary chain still lands; tldr translations succeed
 * or fail per-language. Classification (mode B) retries then falls back to
 * ["other"] like the pipeline.
 *
 * Safety:
 *   - Resumable: fully-written short_ids are recorded in
 *     ~/.cache/picx-debug/fullchain-progress.json and skipped on re-runs.
 *     A paper is only recorded after ALL its DB writes succeeded.
 *   - Any LLM/step failure inside a paper skips that paper entirely (no DB
 *     writes at all, mode B leaves the papers row failed) and it is retried
 *     on the next run.
 *   - `--dry-run` only reads D1 and prints the plan: NO LLM calls, NO R2
 *     fetches, NO writes.
 *
 * Usage (run via the host so node + .dev.vars + wrangler are available):
 *   node scripts/repair-fullchain.mjs [--targets tierA.json] [--failed]
 *       [--dry-run] [--limit N] [--only SHORT_ID] [--concurrency N]
 *
 * At least one of --targets / --failed is required (both can be combined).
 * Defaults: concurrency 2 (a full chain is 8-9 LLM calls per paper). `--only`
 * processes a single short_id and ignores the progress file.
 */

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
const TARGETS_FILE = getOpt("--targets", "");
const FAILED_MODE = hasFlag("--failed");
const DRY_RUN = hasFlag("--dry-run");
const LIMIT = Number(getOpt("--limit", "0")); // 0 = no limit
const CONCURRENCY = Math.max(1, Number(getOpt("--concurrency", "2")));
const ONLY = getOpt("--only", "");
if (hasFlag("--targets") && !TARGETS_FILE) {
  console.error("[fullchain] --targets requires a JSON file path");
  process.exit(1);
}

const PROGRESS_FILE = join(
  homedir(),
  ".cache/picx-debug/fullchain-progress.json",
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

// Full language set = base + the extra translations the arxiv cron enqueues
// (["zh-cn","zh-tw","ja"], src/workers/arxiv-cron.ts). Translation targets are
// LANGS minus the base language: identical to the cron set for en-based papers,
// and for the rare mode-A paper whose base is NOT en this regenerates a fresh
// en translation instead of silently dropping the (broken) en key when the
// summaries JSON is replaced wholesale.
const LANGS = ["en", "zh-cn", "zh-tw", "ja"];
// The R2 text is untrimmed rawText — truncate instead of replaying the LLM
// tail-trim, mirroring INSIGHTS_BACKFILL_MAX_CHARS in src/workers/queue-consumer.ts.
const MAX_TEXT_CHARS = 80_000;
const R2_BUCKET = "picx-papers-apac";

// ---------- D1 access (remote only; parameterized queries — same approach
// as scripts/repair-truncated-translations.mjs) ----------
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

// ---------- R2 full text (via wrangler; key from src/lib/paper-text.ts) ----------
const TMP_DIR = mkdtempSync(join(tmpdir(), "picx-fullchain-"));

async function fetchPaperText(paperId) {
  const tmpFile = join(TMP_DIR, `${paperId}.txt`);
  try {
    await execFileAsync(
      "npx",
      [
        "wrangler",
        "r2",
        "object",
        "get",
        `${R2_BUCKET}/paper-text/${paperId}.txt`,
        "--remote",
        "--file",
        tmpFile,
      ],
      { cwd: projectRoot, maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    const out = `${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message}`;
    // Missing object → the paper was stored before text persistence, or the
    // non-fatal try/catch swallowed a put failure back then. Skip, don't fail.
    if (/does not exist|not found|NoSuchKey|10007|404/i.test(out)) return null;
    throw new Error(`R2 fetch failed for ${paperId}: ${out.slice(0, 300)}`);
  }
  const text = readFileSync(tmpFile, "utf8");
  rmSync(tmpFile, { force: true });
  if (!text.trim()) return null;
  return text;
}

// ---------- OpenAI (conventions mirror repair-truncated-translations.mjs) ----------
async function chatCompletion(systemPrompt, userContent, opts) {
  const { temperature, maxTokens, label, expectLanguage } = opts;
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
      // Reasoning models (e.g. DeepSeek) think by default on OpenRouter and
      // the thinking tokens eat into max_tokens, silently truncating the
      // content — the very bug this script repairs. Disable explicitly —
      // mirrors reasoningParam() in src/lib/ai.ts (only sent to OpenRouter
      // endpoints; the official OpenAI API rejects unknown params).
      // REPAIR_REASONING=<low|high> re-enables thinking for stubborn papers:
      // long inputs with reasoning off tend to fall into a wrong-language
      // attractor (ja answered in Chinese). Pair with REPAIR_MAX_TOKENS=16000 —
      // thinking tokens count against max_tokens on OpenRouter.
      ...(/openrouter/i.test(OPENAI_BASE_URL)
        ? {
            reasoning: process.env.REPAIR_REASONING
              ? { effort: process.env.REPAIR_REASONING }
              : { enabled: false },
          }
        : {}),
    }),
  });
  if (!res.ok) {
    const err = new Error(`OpenAI ${res.status} (${label}): ${await res.text()}`);
    // Rate limits / upstream hiccups are worth retrying; anything else
    // (auth, bad request, ...) should fail the paper immediately.
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }
  const data = await res.json();
  // finish_reason=length means the output was cut off by max_tokens — never
  // store it. Mirrors assertNotTruncated() in src/lib/ai.ts.
  if (data.choices?.[0]?.finish_reason === "length") {
    throw new Error(`${label} truncated (finish_reason=length)`);
  }
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`Empty ${label} response`);
  if (expectLanguage) assertLanguage(text, expectLanguage, label);
  return text;
}

// Wrong-language guard: with reasoning disabled, DeepSeek occasionally answers
// a ja / zh-tw translation request in (Simplified) Chinese. Charset heuristics:
// real Japanese prose always contains kana; real Traditional text uses
// traditional-only variants of common characters. Marked retryable — the
// failure is stochastic, so a re-generation usually fixes it.
const SIMP_ONLY =
  "们与学训练过这为后华语说证观询议记读见问题动态发经将应对样师权术处别构马网络图书区队伤听欢乐东传边远运连迟错优标准确释单纯变现实获难备";
const TRAD_ONLY =
  "們與學訓練過這為後華語說證觀詢議記讀見問題動態發經將應對樣師權術處別構馬網絡圖書區隊傷聽歡樂東傳邊遠運連遲錯優標準確釋單純變現實獲難備";
function countChars(text, set) {
  let n = 0;
  for (const c of text) if (set.includes(c)) n++;
  return n;
}
function assertLanguage(text, lang, label) {
  let msg;
  if (lang === "ja") {
    const kana = (text.match(/[぀-ヿ]/g) || []).length;
    if (kana < Math.max(2, text.length / 500))
      msg = `${label} (ja): no kana in output — model answered in the wrong language`;
  } else if (lang === "zh-tw") {
    if (countChars(text, SIMP_ONLY) > countChars(text, TRAD_ONLY))
      msg = `${label} (zh-tw): output looks Simplified, not Traditional`;
  } else if (lang === "zh-cn") {
    if (countChars(text, TRAD_ONLY) > countChars(text, SIMP_ONLY))
      msg = `${label} (zh-cn): output looks Traditional, not Simplified`;
  }
  if (msg) {
    const err = new Error(msg);
    err.retryable = true;
    throw err;
  }
}

// Exponential-backoff retry. Default: retry 429/5xx only (the
// translateWithRetry convention in repair-truncated-translations.mjs).
// retryAll=true also retries truncation/garbled output — used for the
// non-critical tldr/classify steps, mirroring withRetry in queue-consumer.
async function withRetry(fn, { retries = 3, retryAll = false } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!retryAll && !e.retryable) throw e;
      lastErr = e;
      if (i < retries) {
        await new Promise((res) => setTimeout(res, 1000 * 2 ** i));
      }
    }
  }
  throw lastErr;
}

// ---------- summary generation ----------
// System prompt + call params copied VERBATIM from generateSummary in
// src/lib/ai.ts (temperature 0.7, max_tokens 8000) — keep them in sync.
function summarySystemPrompt(language) {
  const languageInstruction =
    language === "zh-cn"
      ? "请用简体中文回答。"
      : language === "zh-tw"
        ? "請用繁體中文回答。"
        : language === "ja"
          ? "日本語で回答してください。"
          : "Please respond in English.";

  return `You are an expert at summarizing academic papers. Generate a comprehensive, well-structured summary in Markdown format.

${languageInstruction}

Structure your summary with the following sections:

## Summary (Overview)
Provide 3-5 key bullet points highlighting the main contributions and findings.

## Introduction and Theoretical Foundation
Explain the background, motivation, and theoretical basis of the research.

## Methodology
Describe the research methods, approaches, and techniques used.

## Empirical Validation / Results
Present the key experimental results, findings, and evidence.

## Theoretical and Practical Implications
Discuss the significance and impact of the findings.

## Conclusion
Summarize the main takeaways and future directions.

CRITICAL - Preserve Mathematical Content:
- ALWAYS preserve key mathematical formulas, equations, and expressions from the paper
- Use LaTeX notation: $inline$ for inline math, $$display$$ for display equations
- Include formula numbers and references when present in the original paper
- Preserve mathematical notation exactly as it appears (variables, operators, subscripts, superscripts)
- For complex equations, use display mode ($$...$$) with proper formatting
- Put display equations on their own lines with opening and closing $$ on separate lines; do not use single-line $$ equation $$
- Include definitions of key variables and parameters

CRITICAL - Preserve Important Tables:
- ALWAYS include important tables that contain key results, comparisons, or experimental data
- Use Markdown table syntax with proper alignment
- Preserve column headers and row labels exactly
- Include table captions and numbers when present
- For large tables, include the most important rows/columns
- Highlight significant values or patterns in the table caption

Guidelines:
- Use proper Markdown formatting (headers, lists, bold, italic)
- Use code blocks with syntax highlighting when showing code
- Use blockquotes (>) for important quotes or definitions
- Be comprehensive but clear and well-organized
- Prioritize preserving quantitative results, formulas, and data tables over prose descriptions`;
}

function generateSummary(paperText, language) {
  return chatCompletion(
    summarySystemPrompt(language),
    `Please summarize the following academic paper:\n\n${paperText}`,
    {
      temperature: 0.7,
      maxTokens: Number(process.env.REPAIR_MAX_TOKENS || 8000),
      label: "Summary",
      expectLanguage: language,
    },
  );
}

// ---------- summary translation ----------
// System prompt copied VERBATIM from translateSummary in src/lib/ai.ts (via
// scripts/repair-truncated-translations.mjs) — keep them in sync.
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

function translateSummary(summaryText, targetLanguage) {
  return chatCompletion(translationSystemPrompt(targetLanguage), summaryText, {
    temperature: 0.3, // 较低的温度以保持翻译准确性 (same as translateSummary)
    // Very long summaries (>14k chars) can need more than 8000 output tokens
    // for zh translations — override for one-off retries.
    maxTokens: Number(process.env.REPAIR_MAX_TOKENS || 8000),
    label: `Translation (${targetLanguage})`,
    expectLanguage: targetLanguage,
  });
}

// ---------- tldr (prompts copied from scripts/backfill-tldr.mjs, which
// mirrors generateTldr / translateTldr in src/lib/ai.ts — keep in sync) ----------
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
  return chatCompletion(sys, summaryText.slice(0, 3500), {
    temperature: 0.5,
    maxTokens: Number(process.env.REPAIR_MAX_TOKENS || 400),
    label: `Tldr (${language})`,
    expectLanguage: language,
  });
}

function transTldr(tldrText, targetLanguage) {
  const sys = `You are an expert academic translator. Translate the given one-sentence research takeaway into ${languageDisplayName(targetLanguage)}.

STRICT OUTPUT RULES:
- Output ONLY the translated sentence, nothing else.
- Plain text only: NO Markdown, NO LaTeX, NO added quotes.
- Keep technical terms and named methods accurate.
- Preserve the concise, single-sentence form.`;
  return chatCompletion(sys, tldrText, {
    temperature: 0.3,
    maxTokens: Number(process.env.REPAIR_MAX_TOKENS || 400),
    label: `Tldr translation (${targetLanguage})`,
    expectLanguage: targetLanguage,
  });
}

// Non-critical tldr chain, mirrors queue-consumer semantics: only when the
// base tldr exhausts its retries is the whole tldr abandoned (returns null —
// gallery falls back to the summary); translations succeed/fail per-language.
async function buildTldr(baseSummary, baseLang, otherLangs) {
  let baseTldr;
  try {
    baseTldr = await withRetry(() => genTldr(baseSummary, baseLang), {
      retryAll: true,
    });
  } catch (e) {
    console.warn(`    tldr: base generation gave up (${e.message})`);
    return null;
  }
  const tldr = { [baseLang]: baseTldr };
  const settled = await Promise.allSettled(
    otherLangs.map((l) =>
      withRetry(() => transTldr(baseTldr, l), { retryAll: true }),
    ),
  );
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      tldr[otherLangs[i]] = s.value;
    } else {
      console.warn(
        `    tldr: translation gave up for ${otherLangs[i]} (${s.reason?.message})`,
      );
    }
  });
  return tldr;
}

// ---------- classification (mode B only; prompt + parsing copied from
// scripts/backfill-categories.mjs — keep in sync) ----------
// 必须与 src/lib/paper-categories.ts 保持一致。
const CATEGORY_SLUGS = [
  "llm", "nlp", "multimodal", "vision", "generative", "speech-audio",
  "reinforcement-learning", "agents", "reasoning-planning", "retrieval-rag",
  "robotics-3d", "ml-theory", "efficiency", "data-benchmark",
  "alignment-safety", "ai-for-science", "other",
];
const SLUG_SET = new Set(CATEGORY_SLUGS);

async function classify(text) {
  const systemPrompt = `You are an expert at classifying AI/ML research papers.

Pick 1-3 PRIMARY categories from this EXACT fixed list (use the slug verbatim):
${CATEGORY_SLUGS.join(", ")}

Then produce 3-5 free-form fine-grained TAGS (lowercase, hyphenated).

Rules:
- Categories MUST be slugs from the list above. If nothing fits, use ["other"].
- Output ONLY a JSON object, no prose, no code fences:
{"categories":["..."],"tags":["..."]}`;
  const content = await chatCompletion(systemPrompt, text.slice(0, 3500), {
    temperature: 0.2,
    maxTokens: 400, // 200 偏紧:分类+3-5 tag 的 JSON 偶尔被截断成无法解析
    label: "Classification",
  });
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

// 分类带重试:把「other + 空 tags」当作失败(正常分类必带 tag),指数退避重试;
// 重试耗尽由调用方兜底 ["other"](与产线一致,分类失败不阻断整篇)。
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

// ---------- progress file ----------
function loadProgress() {
  if (!existsSync(PROGRESS_FILE)) return new Set();
  try {
    const arr = JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    console.warn(
      `[fullchain] unreadable progress file ${PROGRESS_FILE}, ignoring`,
    );
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

// ---------- target discovery ----------
// Mode A targets: en_broken short_ids joined to their paper_results row.
async function loadModeATargets() {
  const parsed = JSON.parse(readFileSync(TARGETS_FILE, "utf8"));
  const enBroken = parsed.en_broken;
  if (!Array.isArray(enBroken)) {
    throw new Error(`--targets file has no "en_broken" array`);
  }
  const shortIds = [...new Set(enBroken)];
  const rows = [];
  // Chunked IN() lookups: D1 caps bound params at 100 per query.
  for (let i = 0; i < shortIds.length; i += 50) {
    const chunk = shortIds.slice(i, i + 50);
    rows.push(
      ...(await d1Remote(
        `SELECT p.id AS paperId, p.short_id AS shortId,
                pr.id AS resultId, pr.summary_language AS summaryLanguage,
                pr.tldr IS NOT NULL AS hasTldr,
                length(json_extract(pr.summaries, '$.en')) AS enLen
           FROM papers p
           LEFT JOIN paper_results pr ON pr.paper_id = p.id
          WHERE p.short_id IN (${chunk.map(() => "?").join(",")})`,
        chunk,
      )),
    );
  }
  const byShortId = new Map(rows.map((r) => [r.shortId, r]));
  const targets = [];
  for (const sid of shortIds) {
    const row = byShortId.get(sid);
    if (!row) {
      console.warn(`  - ${sid}: paper not found in D1, skipped`);
      continue;
    }
    if (!row.resultId) {
      console.warn(`  - ${sid}: no paper_results row (unexpected for mode A), skipped`);
      continue;
    }
    targets.push({ mode: "A", ...row });
  }
  return targets;
}

// Mode B targets: repairable failed papers — the error happened after text
// extraction, so the full text is already in R2. fetch-pdf/extract-text
// failures are NOT repairable here and stay untouched.
async function loadModeBTargets() {
  const rows = await d1Remote(
    `SELECT id AS paperId, short_id AS shortId, error_message AS errorMessage
       FROM papers
      WHERE status = 'failed' AND deleted_at IS NULL
        AND (error_message LIKE '%translate-summary%'
          OR error_message LIKE '%generate-summary%'
          OR error_message LIKE '%generate-whiteboard%')`,
  );
  // Failed papers have no results row → base language "en".
  return rows.map((r) => ({ mode: "B", summaryLanguage: "en", ...r }));
}

// ---------- per-paper processing ----------
async function processPaper(t) {
  // Normalize base language defensively: generateSummary only supports the 4
  // known languages (summary_language defaults to "en" in the schema).
  const baseLang = LANGS.includes(t.summaryLanguage) ? t.summaryLanguage : "en";
  const extraLangs = LANGS.filter((l) => l !== baseLang);

  if (DRY_RUN) {
    if (t.mode === "A") {
      console.log(
        `  • ${t.shortId} [A]: would regen summary(${baseLang}) + translate [${extraLangs.join(",")}] + tldr, UPDATE summaries+tldr (en now ${t.enLen ?? 0} chars, tldr ${t.hasTldr ? "present" : "absent"})`,
      );
    } else {
      console.log(
        `  • ${t.shortId} [B]: would regen summary(${baseLang}) + translate [${extraLangs.join(",")}] + tldr + categories, DELETE+INSERT paper_results, papers → completed (error: ${String(t.errorMessage ?? "").slice(0, 80)})`,
      );
    }
    return "done";
  }

  // 1. Full text from R2 (missing → skip & report; storing it was non-fatal
  // back then so a few papers may legitimately lack it).
  const rawText = await fetchPaperText(t.paperId);
  if (rawText === null) {
    console.warn(`  - ${t.shortId}: no paper text in R2, skipped`);
    return "no_text";
  }
  const text = rawText.slice(0, MAX_TEXT_CHARS);

  // 2. Base summary, then translations (any failure here throws → the whole
  // paper is skipped with NO writes and retried next run).
  const summary = await withRetry(() => generateSummary(text, baseLang));
  const translations = await Promise.all(
    extraLangs.map((l) => withRetry(() => translateSummary(summary, l))),
  );
  const summaries = { [baseLang]: summary };
  extraLangs.forEach((l, i) => {
    summaries[l] = translations[i];
  });

  // 3. Non-critical tldr (null → mode A keeps old value, mode B stores NULL).
  const tldr = await buildTldr(summary, baseLang, extraLangs);

  if (t.mode === "A") {
    // UPDATE only summaries + tldr; categories/tags/whiteboardInsights/
    // summaryLanguage keep their old values. Single-row single-statement
    // UPDATE — safe without transactions on D1.
    if (tldr) {
      await d1Remote(
        "UPDATE paper_results SET summaries = ?, tldr = ? WHERE id = ?",
        [JSON.stringify(summaries), JSON.stringify(tldr), t.resultId],
      );
    } else {
      await d1Remote("UPDATE paper_results SET summaries = ? WHERE id = ?", [
        JSON.stringify(summaries),
        t.resultId,
      ]);
    }
    console.log(
      `  ✓ ${t.shortId} [A]: summaries [${Object.keys(summaries).join(",")}]${tldr ? ` + tldr [${Object.keys(tldr).join(",")}]` : " (tldr kept old value)"}`,
    );
    return "done";
  }

  // Mode B: also classify (retry then fall back to ["other"], like the
  // pipeline — classification failure never blocks the paper).
  let classification;
  try {
    classification = await classifyWithRetry(text);
  } catch {
    classification = { categories: ["other"], tags: [] };
  }

  const nowSec = Math.floor(Date.now() / 1000); // D1 timestamps are unix seconds

  // Idempotent cleanup then insert — mirrors queue-consumer.ts (Step 6):
  // failed papers should have no results row, but a previous crash between
  // writes could have left one; delete defensively before inserting.
  await d1Remote("DELETE FROM paper_results WHERE paper_id = ?", [t.paperId]);
  await d1Remote(
    `INSERT INTO paper_results
       (id, paper_id, summaries, tldr, categories, tags, summary_language,
        whiteboard_insights, processing_time_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    [
      crypto.randomUUID(),
      t.paperId,
      JSON.stringify(summaries),
      tldr ? JSON.stringify(tldr) : null,
      JSON.stringify(classification.categories),
      JSON.stringify(classification.tags),
      baseLang,
      nowSec,
    ],
  );
  // papers flip LAST: status is the consumer-side idempotency guard — a crash
  // before this line leaves the paper failed (retried next run), never
  // "completed without results".
  await d1Remote(
    "UPDATE papers SET status = 'completed', error_message = NULL, updated_at = ? WHERE id = ?",
    [nowSec, t.paperId],
  );
  console.log(
    `  ✓ ${t.shortId} [B]: results written (cats=[${classification.categories.join(",")}]${tldr ? "" : ", tldr=null"}), papers → completed`,
  );
  return "done";
}

// ---------- main ----------
async function main() {
  if (!ACCOUNT_ID || !API_TOKEN || !DB_ID) {
    throw new Error("Missing CLOUDFLARE_* credentials in .dev.vars");
  }
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY in .dev.vars");
  if (!TARGETS_FILE && !FAILED_MODE) {
    throw new Error(
      "Nothing to do: pass --targets <tierA.json> (mode A) and/or --failed (mode B)",
    );
  }

  let targets = [];
  if (TARGETS_FILE) {
    const a = await loadModeATargets();
    console.log(`[fullchain] mode A (en_broken): ${a.length} paper(s)`);
    targets.push(...a);
  }
  if (FAILED_MODE) {
    const b = await loadModeBTargets();
    console.log(`[fullchain] mode B (repairable failed): ${b.length} paper(s)`);
    targets.push(...b);
  }

  const done = loadProgress();
  if (ONLY) {
    // --only ignores the progress file so a single paper can be re-run.
    targets = targets.filter((t) => t.shortId === ONLY);
    if (targets.length === 0) {
      throw new Error(`--only ${ONLY}: not present in the target set`);
    }
  } else {
    const before = targets.length;
    targets = targets.filter((t) => !done.has(t.shortId));
    if (before !== targets.length) {
      console.log(
        `[fullchain] ${before - targets.length} paper(s) already done (progress file), skipping.`,
      );
    }
  }
  if (LIMIT) targets = targets.slice(0, LIMIT);

  console.log(
    `[fullchain] ${targets.length} paper(s) to process.${DRY_RUN ? " (DRY RUN — no LLM calls, no R2 fetches, no writes)" : ""}`,
  );
  console.log(
    `[fullchain] concurrency=${CONCURRENCY}${LIMIT ? ` limit=${LIMIT}` : ""}${ONLY ? ` only=${ONLY}` : ""}`,
  );

  const succeeded = [];
  const noText = [];
  const failed = [];

  await pool(
    targets,
    async (t) => {
      try {
        const r = await processPaper(t);
        if (r === "no_text") {
          noText.push(t.shortId);
          return;
        }
        succeeded.push(t.shortId);
        if (!DRY_RUN) {
          done.add(t.shortId);
          saveProgress(done);
        }
      } catch (e) {
        failed.push(t.shortId);
        console.warn(`  ✗ ${t.shortId} [${t.mode}]: ${e.message}`);
      }
    },
    CONCURRENCY,
  );

  rmSync(TMP_DIR, { recursive: true, force: true });

  console.log(
    `[fullchain] done. succeeded=${succeeded.length} no_text=${noText.length} failed=${failed.length}`,
  );
  if (succeeded.length) console.log(`  succeeded: ${succeeded.join(", ")}`);
  if (noText.length) console.log(`  no_text (skipped): ${noText.join(", ")}`);
  if (failed.length) console.log(`  failed: ${failed.join(", ")}`);
}

main().catch((e) => {
  console.error("[fullchain] fatal:", e);
  process.exit(1);
});
