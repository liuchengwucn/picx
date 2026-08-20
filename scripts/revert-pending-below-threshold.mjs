#!/usr/bin/env node
/**
 * One-off cleanup after raising RELEVANCE_THRESHOLD (2026-08-20, 55 -> 60).
 *
 * Why this is needed: embedStage selects `status='pending' AND relevance_score
 * >= RELEVANCE_THRESHOLD AND embedding IS NULL`. Raising the threshold strands
 * any already-pending row scored below the new value — it will never be
 * embedded, never clustered, and never re-scored (filterStage only picks rows
 * with relevance_score IS NULL). Those rows become invisible zombies, so they
 * are put back to 'rejected', which is what the new threshold means for them.
 *
 * Rows that were already embedded are left alone: clusterStage does not check
 * the threshold, so they still cluster normally and are not stranded.
 *
 * Safety: default dry run; idempotent (predicate excludes already-rejected).
 *
 * Usage: node scripts/revert-pending-below-threshold.mjs [--threshold 60] [--apply]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const i = args.indexOf("--threshold");
const THRESHOLD = Number(i >= 0 && args[i + 1] ? args[i + 1] : 60);

const E = {};
for (const line of readFileSync(join(projectRoot, ".dev.vars"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1);
  E[m[1]] = v;
}

async function d1(sql, params = []) {
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
  if (!json.success) throw new Error(`D1 failed: ${JSON.stringify(json.errors)}`);
  return json.result[0].results;
}

const rows = await d1(
  `SELECT ni.id, ni.relevance_score AS score, ns.name AS src, substr(ni.title,1,80) AS title
   FROM news_items ni JOIN news_sources ns ON ns.id = ni.source_id
   WHERE ni.status = 'pending' AND ni.relevance_score IS NOT NULL
     AND ni.relevance_score < ? AND ni.embedding IS NULL
   ORDER BY ni.relevance_score DESC`,
  [THRESHOLD],
);

console.log(`门槛 ${THRESHOLD}：发现 ${rows.length} 条会被卡住的 pending 条目`);
for (const r of rows) console.log(`  ${r.score} [${r.src}] ${r.title}`);
if (rows.length > 0) {
  if (!APPLY) {
    console.log("\n(dry run，未写库) 加 --apply 执行");
  } else {
    let n = 0;
    for (const r of rows) {
      await d1(
        `UPDATE news_items SET status = 'rejected'
         WHERE id = ? AND status = 'pending' AND embedding IS NULL`,
        [r.id],
      );
      n++;
    }
    console.log(`\n已将 ${n} 条改回 rejected`);
  }
}
