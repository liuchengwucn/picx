#!/usr/bin/env node
/**
 * Normalize `source_url` of existing arXiv papers to the canonical form
 * `https://arxiv.org/abs/{id}` (no protocol/host variants, no /pdf/, no `.pdf`,
 * no version suffix `vN`).
 *
 * Motivation: canonical source_url is the identity key used by three separate
 * code paths — the gallery partial unique index
 * (`papers_gallery_source_url_unique`), the application-level duplicate check in
 * `paper.create`, and the assistant card's `inLibrary` lookup. New arXiv rows
 * are written canonical (see src/lib/arxiv.ts), but historical rows may store
 * `/pdf/`, `vN`, or `http://` variants, which produce inLibrary false negatives,
 * missed dedup and inconsistent gallery uniqueness. This one-off script brings
 * legacy rows in line.
 *
 * Scope:
 *   - Reads every row with `source_type = 'arxiv' AND source_url IS NOT NULL`,
 *     including soft-deleted ones (reported for visibility only).
 *   - Only rows with `deleted_at IS NULL` are ever UPDATEd: rewriting a
 *     soft-deleted row buys nothing and could collide with a unique index.
 *
 * Safety:
 *   - `--dry-run` prints the full report and writes nothing.
 *   - Idempotent & resumable: each UPDATE carries `WHERE id = ? AND source_url =
 *     ?<old value>`, so re-running after a partial run is a no-op for rows that
 *     already moved, and a concurrent writer can never be clobbered.
 *   - Gallery conflicts are detected *before* any write and skipped: if two
 *     gallery-listed, non-deleted rows would end up sharing a canonical URL, the
 *     UPDATE would violate `papers_gallery_source_url_unique`. Those rows are
 *     reported as pairs for a human to resolve (unlist one of them) instead.
 *     Note that no transient conflict is possible for the rows we do update:
 *     canonicalization is idempotent, so a row already sitting on a canonical
 *     URL is by definition not a candidate and never moves away from it — there
 *     are no update chains/cycles, only the static collisions checked here.
 *   - Same-user duplicates (two rows of one user converging on one URL) do not
 *     violate any DB constraint; they are only reported so the user can clean up.
 *   - Small batches, well under D1's 100 bound-parameter per-query limit.
 *
 * Only the Cloudflare D1 REST API is contacted; behind a proxy set
 * NODE_USE_ENV_PROXY=1 + HTTPS_PROXY.
 *
 * Usage (run on the host so .dev.vars is available):
 *   node scripts/backfill-canonical-source-url.mjs [--dry-run] [--limit N]
 *        [--batch N]
 *   Defaults: batch 25, no limit. ALWAYS review a --dry-run report first.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getOpt = (f, def) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DRY_RUN = hasFlag("--dry-run");
const LIMIT = Number(getOpt("--limit", "0"));
const BATCH = Math.max(1, Number(getOpt("--batch", "25")));

function loadDevVars() {
  const raw = readFileSync(join(projectRoot, ".dev.vars"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const E = loadDevVars();
const ACCOUNT_ID = E.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = E.CLOUDFLARE_API_TOKEN;
const DB_ID = E.CLOUDFLARE_D1_DATABASE_ID;

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
  return json.result[0];
}

// --- canonicalization -------------------------------------------------------
// MUST stay in sync with src/lib/arxiv.ts (canonicalArxivId / canonicalArxivUrl).
// This file is .mjs and cannot import the TS module, so both regexes are copied
// verbatim; if you change one side, change the other.

/** 从 arXiv id 或 URL 中抽取规范化的 arXiv id(去版本号)。识别不到返回 null。 */
function canonicalArxivId(idOrUrl) {
  const raw = idOrUrl.trim();

  // 新格式: 2601.13209 / 2601.13209v2 (可能带 abs/pdf 路径或 .pdf 后缀)
  const modern = raw.match(/(\d{4}\.\d{4,5})(v\d+)?/);
  if (modern) {
    return modern[1];
  }

  // 旧格式: archive/YYMMNNN, 如 hep-th/9901001 (可能带版本号)
  const legacy = raw.match(/([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i);
  if (legacy) {
    return legacy[1];
  }

  return null;
}

/** arXiv URL 规范化; 无法识别时原样返回 trim 后的输入。 */
function canonicalArxivUrl(idOrUrl) {
  const id = canonicalArxivId(idOrUrl);
  return id ? `https://arxiv.org/abs/${id}` : idOrUrl.trim();
}

/** 把非 canonical 的旧形态分桶, 便于报告里看清历史成因。 */
function shapeOf(url) {
  const buckets = [];
  if (/\/pdf\//i.test(url) || /\.pdf(\?|#|$)/i.test(url)) buckets.push("pdf");
  if (/\d{4}\.\d{4,5}v\d+/i.test(url) || /\/\d{7}v\d+/i.test(url))
    buckets.push("versioned");
  if (/^http:\/\//i.test(url)) buckets.push("http");
  if (url !== url.trim()) buckets.push("whitespace");
  return buckets.length ? buckets.join("+") : "other";
}

// --- fetch all arXiv rows (paged; D1 REST caps response size) ---------------
async function fetchAllRows() {
  const PAGE = 500;
  const rows = [];
  let offset = 0;
  while (true) {
    const { results } = await d1Remote(
      `SELECT id, user_id, short_id, source_url, is_listed_in_gallery, deleted_at
         FROM papers
        WHERE source_type = 'arxiv' AND source_url IS NOT NULL
        ORDER BY id
        LIMIT ? OFFSET ?`,
      [PAGE, offset],
    );
    rows.push(...results);
    if (results.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

function analyze(rows) {
  const live = rows.filter((r) => r.deleted_at === null);
  const deleted = rows.filter((r) => r.deleted_at !== null);

  const withCanonical = live.map((r) => ({
    ...r,
    canonical: canonicalArxivUrl(r.source_url),
    gallery: r.is_listed_in_gallery === 1 || r.is_listed_in_gallery === true,
  }));
  const candidates = withCanonical.filter((r) => r.canonical !== r.source_url);
  const deletedCandidates = deleted.filter(
    (r) => canonicalArxivUrl(r.source_url) !== r.source_url,
  );

  // shape buckets
  const shapes = new Map();
  for (const r of candidates) {
    const k = shapeOf(r.source_url);
    shapes.set(k, (shapes.get(k) ?? 0) + 1);
  }

  // unrecognizable ids: canonical() fell back to trim(), still != original only
  // via whitespace. Track rows where no arXiv id could be parsed at all.
  const unparsable = live.filter((r) => canonicalArxivId(r.source_url) === null);

  // --- gallery conflict pre-check -------------------------------------------
  // Occupants: gallery+live rows keyed by the URL they will hold afterwards.
  const galleryByUrl = new Map();
  for (const r of withCanonical) {
    if (!r.gallery) continue;
    const key = r.canonical !== r.source_url ? r.canonical : r.source_url;
    if (!galleryByUrl.has(key)) galleryByUrl.set(key, []);
    galleryByUrl.get(key).push(r);
  }
  const galleryConflicts = [];
  const blockedIds = new Set();
  for (const [url, group] of galleryByUrl) {
    if (group.length < 2) continue;
    const movers = group.filter((r) => r.canonical !== r.source_url);
    if (movers.length === 0) continue; // pre-existing dup, not caused by us
    for (const m of movers) blockedIds.add(m.id);
    galleryConflicts.push({ url, group });
  }

  const toUpdate = candidates.filter((r) => !blockedIds.has(r.id));

  // --- same-user duplicate report -------------------------------------------
  const byUserUrl = new Map();
  for (const r of withCanonical) {
    const key = `${r.user_id} ${r.canonical !== r.source_url ? r.canonical : r.source_url}`;
    if (!byUserUrl.has(key)) byUserUrl.set(key, []);
    byUserUrl.get(key).push(r);
  }
  const userDuplicates = [];
  for (const [key, group] of byUserUrl) {
    if (group.length < 2) continue;
    if (!group.some((r) => r.canonical !== r.source_url)) continue;
    const [userId, url] = key.split(" ");
    userDuplicates.push({ userId, url, group });
  }

  return {
    rows,
    live,
    deleted,
    candidates,
    deletedCandidates,
    shapes,
    unparsable,
    galleryConflicts,
    userDuplicates,
    toUpdate,
  };
}

function report(a) {
  const p = console.log;
  p("");
  p("=== canonical source_url backfill report ===");
  p(`arXiv rows with source_url : ${a.rows.length}`);
  p(`  live (deleted_at IS NULL): ${a.live.length}`);
  p(`  soft-deleted             : ${a.deleted.length}`);
  p(`non-canonical (live)       : ${a.candidates.length}`);
  p(
    `non-canonical (soft-deleted, NOT touched): ${a.deletedCandidates.length}`,
  );
  p("");
  p("-- shape buckets (live non-canonical) --");
  const order = [...a.shapes.entries()].sort((x, y) => y[1] - x[1]);
  if (order.length === 0) p("  (none)");
  for (const [k, n] of order) p(`  ${k.padEnd(20)} ${n}`);

  if (a.unparsable.length) {
    p("");
    p(`-- no arXiv id parsed (${a.unparsable.length}) --`);
    for (const r of a.unparsable.slice(0, 50))
      p(`  ${r.short_id}  ${r.source_url}`);
    if (a.unparsable.length > 50)
      p(`  ... ${a.unparsable.length - 50} more`);
  }

  p("");
  p(`-- gallery conflicts (SKIPPED, need manual unlist): ${a.galleryConflicts.length} --`);
  for (const c of a.galleryConflicts) {
    p(`  ${c.url}`);
    for (const r of c.group) {
      const moving = r.canonical !== r.source_url ? "MOVER " : "SITTER";
      p(`    [${moving}] ${r.short_id}  user=${r.user_id}  ${r.source_url}`);
    }
  }
  if (a.galleryConflicts.length === 0) p("  (none)");

  p("");
  p(`-- same-user duplicates after normalization (reported only): ${a.userDuplicates.length} --`);
  for (const d of a.userDuplicates) {
    p(`  user=${d.userId}  ${d.url}`);
    for (const r of d.group) {
      const moving = r.canonical !== r.source_url ? "MOVER " : "SITTER";
      p(
        `    [${moving}] ${r.short_id}  gallery=${r.gallery ? 1 : 0}  ${r.source_url}`,
      );
    }
  }
  if (a.userDuplicates.length === 0) p("  (none)");

  p("");
  p(`planned UPDATEs: ${a.toUpdate.length}`);
  p("===========================================");
  p("");
}

async function main() {
  if (!ACCOUNT_ID || !API_TOKEN || !DB_ID) {
    throw new Error("Missing CLOUDFLARE_* credentials in .dev.vars");
  }
  console.log(
    `[backfill-canonical-source-url] scanning papers...${DRY_RUN ? " (DRY RUN)" : ""}`,
  );
  const rows = await fetchAllRows();
  const a = analyze(rows);
  report(a);

  if (DRY_RUN) {
    console.log("[backfill-canonical-source-url] dry run, nothing written.");
    return;
  }

  const targets = LIMIT ? a.toUpdate.slice(0, LIMIT) : a.toUpdate;
  let updated = 0;
  let noop = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    for (const r of batch) {
      // WHERE carries the old value => idempotent + resumable + never clobbers a
      // concurrent writer. 3 bound params per statement, far below D1's 100.
      // `updated_at` is deliberately left alone: this is a mechanical identity
      // normalization, not a user-visible edit.
      const { meta } = await d1Remote(
        "UPDATE papers SET source_url = ? WHERE id = ? AND source_url = ?",
        [r.canonical, r.id, r.source_url],
      );
      const changed = meta?.changes ?? 0;
      if (changed > 0) {
        updated++;
        console.log(`  ✓ ${r.short_id}: ${r.source_url} -> ${r.canonical}`);
      } else {
        noop++;
        console.log(`  - ${r.short_id}: already changed elsewhere, skipped`);
      }
    }
    console.log(
      `[backfill-canonical-source-url] progress ${Math.min(i + BATCH, targets.length)}/${targets.length}`,
    );
  }
  console.log(
    `[backfill-canonical-source-url] done. updated=${updated} noop=${noop} skipped_gallery_conflict=${a.candidates.length - a.toUpdate.length}`,
  );
}

main().catch((e) => {
  console.error("[backfill-canonical-source-url] fatal:", e);
  process.exit(1);
});
