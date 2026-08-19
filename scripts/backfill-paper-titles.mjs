#!/usr/bin/env node
/**
 * Repair papers.title for arXiv-sourced papers against the authoritative arXiv API.
 *
 * Until the title-arbitration fix (2026-08-19), the queue consumer overwrote the
 * clean HF/arXiv title with whatever the parse step produced: MinerU's markdown
 * H1 (which turns small caps into `Th<sub>e</sub>` and escapes `$` as `\$`) or,
 * on the pdfjs fallback path, the raw PDF metadata Title (`Microsoft Word -
 * xxx.docx`). A 2026-08-19 audit of all 805 arXiv papers found ~33 damaged
 * titles: truncated subtitles, OCR typos, and pure fallbacks like `2410.01756`.
 *
 * The comparison target is the **v1** arXiv title, not the latest one: v1 is the
 * version whose PDF we actually ingested, so papers that were renamed upstream
 * (11 of the 30 diffs in the audit) are correctly left alone.
 *
 * Runs through tsx (imports the production cleaner so the rules stay identical):
 *   npm run db:backfill-paper-titles                          # dry run, prints a diff list
 *   npm run db:backfill-paper-titles -- --apply --ids-file f  # write reviewed short_ids
 *
 * Requires CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN /
 * CLOUDFLARE_D1_DATABASE_ID in .dev.vars. Remote-only (production D1 via REST).
 * If fetch() fails with a network error on the host, retry with
 * NODE_USE_ENV_PROXY=1 (see project memory: X repost proxy).
 *
 * Safety:
 *   - Default is dry-run; --apply alone still refuses to write without --ids-file,
 *     so the list always passes through human review (see the news-noise
 *     backfill: an unreviewed bulk rewrite mislabelled real content).
 *   - Updates are guarded with `AND title = <old value>`: a concurrent pipeline
 *     write or a re-run against changed data is a no-op instead of a clobber.
 *   - Idempotent: a repaired title matches the arXiv title and drops out of the
 *     candidate list on the next run.
 *   - arXiv API is queried serially in batches of 50 ids with a 3.5s gap
 *     (their guidance is one request every ~3s).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanExtractedTitle } from "../src/lib/paper-title.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// ---------- args ----------
const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getOpt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const APPLY = hasFlag("--apply");
const DRY_RUN = !APPLY;
const IDS_FILE = getOpt("--ids-file", "");
const OUT_FILE = getOpt("--out", join(projectRoot, "docs/title-diffs.json"));
const LIMIT = Number(getOpt("--limit", "0")); // 0 = no limit

const ARXIV_BATCH = 50;
const ARXIV_GAP_MS = 3500;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- D1 (REST) ----------
const D1_ATTEMPTS = 3;

async function d1(sql, params = []) {
  let lastError;
  for (let attempt = 1; attempt <= D1_ATTEMPTS; attempt++) {
    try {
      return await d1Once(sql, params);
    } catch (err) {
      lastError = err;
      if (attempt < D1_ATTEMPTS) await sleep(2000 * attempt);
    }
  }
  throw lastError;
}

async function d1Once(sql, params = []) {
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

// ---------- arXiv ----------
const ARXIV_ID = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i;

const decodeXmlText = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** 拉一批 arXiv 标题，返回 Map<arxivId, title>。version=true 时取 v1。 */
async function fetchArxivTitles(ids, v1 = false) {
  const query = ids.map((id) => (v1 ? `${id}v1` : id)).join(",");
  const url = `https://export.arxiv.org/api/query?id_list=${query}&max_results=${ids.length}`;

  let xml = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        xml = await res.text();
        break;
      }
    } catch {
      // 网络抖动，重试
    }
    if (attempt < 3) await sleep(5000 * attempt);
  }

  const out = new Map();
  for (const entry of xml.split("<entry>").slice(1)) {
    const idMatch = entry.match(
      /<id>https?:\/\/arxiv\.org\/abs\/(\d{4}\.\d{4,5})/,
    );
    const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
    if (!idMatch || !titleMatch) continue;
    const title = cleanExtractedTitle(decodeXmlText(titleMatch[1]));
    if (title.length > 0) out.set(idMatch[1], title);
  }
  return out;
}

/**
 * 只比内容，忽略排版差异——已被清洗规则处理掉的差异不该算作候选。
 * Unicode 上下标要先折回 ASCII 数字，否则清洗产出的 `PR²` 会跟 arXiv 的
 * `PR2` 判为内容不同，白白把好标题覆盖回纯文本。
 */
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const SUB = "₀₁₂₃₄₅₆₇₈₉";
const normalize = (s) =>
  [...s]
    .map((ch) => {
      const sup = SUP.indexOf(ch);
      if (sup >= 0) return String(sup);
      const sub = SUB.indexOf(ch);
      return sub >= 0 ? String(sub) : ch;
    })
    .join("")
    .toLowerCase()
    .replace(/<\/?[a-z]+[^>]*>/g, "")
    .replace(/\\[a-z]+\s*/g, "")
    .replace(/[^a-z0-9]/g, "");

// ---------- main ----------
async function main() {
  const missing = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_D1_DATABASE_ID",
  ].filter((k) => !E[k]);
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(", ")} in .dev.vars`);
  }

  const rows = await d1(
    `SELECT id, short_id, source_url, title
     FROM papers
     WHERE deleted_at IS NULL AND source_type = 'arxiv'
       AND source_url LIKE '%arxiv.org%'
     ORDER BY created_at${LIMIT > 0 ? ` LIMIT ${LIMIT}` : ""}`,
  );

  const targets = [];
  for (const r of rows) {
    const m = r.source_url.match(ARXIV_ID);
    if (m) targets.push({ ...r, arxivId: m[1] });
  }
  console.log(
    `[backfill-paper-titles] ${targets.length} arXiv paper(s) to check.${DRY_RUN ? " (DRY RUN — pass --apply --ids-file to write)" : " (APPLY)"}`,
  );

  // 同一 arXiv id 可能对应多篇（重复入库），按 id 去重后再查。
  // 两套标题都要：latest 是 arXiv 页面当前显示的，v1 是我们实际抓到的那版 PDF。
  // 论文改过名时库里存的往往是其中一版且完全正确，只有两版都对不上才是真坏。
  const uniqueIds = [...new Set(targets.map((t) => t.arxivId))];
  const latest = new Map();
  const v1 = new Map();
  for (let i = 0; i < uniqueIds.length; i += ARXIV_BATCH) {
    const batch = uniqueIds.slice(i, i + ARXIV_BATCH);
    for (const [wantV1, target] of [
      [false, latest],
      [true, v1],
    ]) {
      try {
        for (const [k, v] of await fetchArxivTitles(batch, wantV1)) {
          target.set(k, v);
        }
      } catch (err) {
        console.error(
          `✗ arXiv batch ${i / ARXIV_BATCH + 1}${wantV1 ? " (v1)" : ""} failed: ${String(err?.message ?? err).slice(0, 200)}`,
        );
      }
      await sleep(ARXIV_GAP_MS);
    }
    process.stdout.write(
      `  fetched ${latest.size}/${uniqueIds.length} titles (v1: ${v1.size})\r`,
    );
  }
  console.log(
    `\n  arXiv titles resolved: latest=${latest.size} v1=${v1.size} of ${uniqueIds.length}`,
  );

  const candidates = [];
  let unresolved = 0;
  for (const t of targets) {
    const authoritative = latest.get(t.arxivId) ?? v1.get(t.arxivId);
    if (!authoritative) {
      unresolved++;
      continue;
    }
    // 先按当前清洗规则处理库里的值：清洗就能修好的不必换内容
    const current = cleanExtractedTitle(t.title);
    const currentNorm = normalize(current);
    const matchesAnyVersion = [latest.get(t.arxivId), v1.get(t.arxivId)]
      .filter(Boolean)
      .some((official) => currentNorm === normalize(official));

    if (matchesAnyVersion) {
      // 内容一致但排版有噪音（`\$15` / `<sub>`），清洗一次即可
      if (current !== t.title) {
        candidates.push({ ...t, newTitle: current, kind: "clean" });
      }
      continue;
    }
    candidates.push({ ...t, newTitle: authoritative, kind: "content" });
  }

  console.log(
    `[backfill-paper-titles] candidates: ${candidates.length} (content=${candidates.filter((c) => c.kind === "content").length}, clean=${candidates.filter((c) => c.kind === "clean").length}), unresolved=${unresolved}`,
  );

  if (DRY_RUN) {
    for (const c of candidates) {
      console.log(`\n[${c.short_id}] ${c.arxivId} (${c.kind})`);
      console.log(`  old: ${c.title}`);
      console.log(`  new: ${c.newTitle}`);
    }
    writeFileSync(OUT_FILE, JSON.stringify(candidates, null, 2));
    console.log(
      `\n[backfill-paper-titles] wrote ${candidates.length} candidate(s) to ${OUT_FILE}`,
    );
    console.log(
      "[backfill-paper-titles] review it, then: --apply --ids-file <file with one short_id per line>",
    );
    return;
  }

  if (!IDS_FILE) {
    throw new Error(
      "--apply requires --ids-file: rewriting titles in bulk without human review is not allowed",
    );
  }
  const allowed = new Set(
    readFileSync(IDS_FILE, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#")),
  );
  const toApply = candidates.filter((c) => allowed.has(c.short_id));
  const notFound = [...allowed].filter(
    (id) => !candidates.some((c) => c.short_id === id),
  );
  console.log(
    `[backfill-paper-titles] applying ${toApply.length}/${allowed.size} reviewed short_id(s)`,
  );
  if (notFound.length > 0) {
    console.log(
      `[backfill-paper-titles] not in candidate list (already fixed or changed): ${notFound.join(", ")}`,
    );
  }

  let ok = 0;
  const failures = [];
  for (const [idx, c] of toApply.entries()) {
    try {
      // title = ? 守卫：库里的值若已被改动就跳过，不覆盖别人的写入
      await d1("UPDATE papers SET title = ? WHERE id = ? AND title = ?", [
        c.newTitle,
        c.id,
        c.title,
      ]);
      ok++;
      console.log(`✓ [${idx + 1}/${toApply.length}] ${c.short_id} ${c.newTitle}`);
    } catch (err) {
      failures.push({
        short_id: c.short_id,
        error: String(err?.message ?? err).slice(0, 200),
      });
      console.error(`✗ [${idx + 1}/${toApply.length}] ${c.short_id}: ${err}`);
    }
    if (idx < toApply.length - 1) await sleep(200);
  }

  console.log(
    `[backfill-paper-titles] done. ok=${ok} failed=${failures.length}`,
  );
  for (const f of failures) console.log(`  ${f.short_id}: ${f.error}`);
}

main().catch((e) => {
  console.error("[backfill-paper-titles] fatal:", e);
  process.exit(1);
});
