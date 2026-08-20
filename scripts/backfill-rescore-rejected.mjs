#!/usr/bin/env node
/**
 * One-off backfill: re-score recently rejected news_items with the CURRENT
 * FILTER_SYSTEM prompt and re-admit the ones that now clear the threshold.
 *
 * Context: the prompt was rewritten (2026-08-20) after a 40-group human-labelled
 * bench showed the old one rejected more than half of the items that should have
 * been kept. The new prompt only affects future scoring, so this script rescues
 * the recent backlog that the old prompt wrongly rejected.
 *
 * What "re-admit" means: set status='rejected' -> 'pending' and write the new
 * score + gist. The cron pipeline takes it from there — embedStage picks up
 * pending items with score >= threshold and a NULL embedding, then clusterStage
 * assigns a story. filterStage will NOT re-score them (it only selects rows with
 * relevance_score IS NULL), so there is no scoring loop.
 *
 * Safety:
 *   - default is a dry run; nothing is written without --apply
 *   - the dry run writes its exact decisions to a JSON file, and --apply reads
 *     that file instead of re-running the model. Re-running the LLM at apply
 *     time can drift from what was reviewed (this bit us in the 2026-08-13
 *     noise cleanup), so the reviewed decisions are applied verbatim.
 *   - idempotent: only rows still status='rejected' are selected/updated
 *   - the prompt is read out of src/lib/news/ai.ts, never copy-pasted, so this
 *     can never score against a stale prompt
 *
 * Usage:
 *   node scripts/backfill-rescore-rejected.mjs [--hours 72] [--out <path>]
 *   node scripts/backfill-rescore-rejected.mjs --apply --from-file <path>
 */
import { readFileSync, writeFileSync } from "node:fs";
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
const APPLY = hasFlag("--apply");
const HOURS = Number(getOpt("--hours", "72"));
const OUT = getOpt("--out", join(projectRoot, "docs/calib/rescore-72h.json"));
const FROM_FILE = getOpt("--from-file", OUT);
// 与生产一致：src/workers/news-cron.ts 的 RELEVANCE_THRESHOLD / FILTER_BATCH_SIZE
const THRESHOLD = 55;
const BATCH = 25;
const CONC = 3;

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
const MAX_GIST = 300;

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
  if (!json.success)
    throw new Error(`D1 query failed: ${JSON.stringify(json.errors)}`);
  return json.result[0].results;
}

/** 从 src/lib/news/ai.ts 直接读取线上 FILTER_SYSTEM，杜绝复制粘贴造成的漂移 */
function liveFilterSystem() {
  const src = readFileSync(join(projectRoot, "src/lib/news/ai.ts"), "utf8");
  const m = src.match(/const FILTER_SYSTEM = `([\s\S]*?)`;/);
  if (!m) throw new Error("FILTER_SYSTEM not found in src/lib/news/ai.ts");
  return m[1].trim();
}

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chatJson(system, user) {
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
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: 4000,
      reasoning: { enabled: false },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  if (data.choices?.[0]?.finish_reason === "length")
    throw new Error("truncated");
  const c = data.choices?.[0]?.message?.content ?? "";
  const s = c.indexOf("{");
  if (s < 0) throw new Error("no JSON");
  let depth = 0,
    inStr = false,
    esc = false;
  for (let i = s; i < c.length; i++) {
    const ch = c[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(c.slice(s, i + 1));
  }
  throw new Error("unbalanced JSON");
}

// 生产 prompt 渲染格式（src/lib/news/ai.ts 的 scoreRelevance）：来源前缀 + 标题 200 字 + excerpt 800 字
const renderList = (rows) =>
  rows
    .map(
      (r, i) =>
        `${i + 1}. ${r.src ? `[${clean(r.src).slice(0, 50)}] ` : ""}${clean(r.title).slice(0, 200)}\n${clean(r.excerpt).slice(0, 800)}`,
    )
    .join("\n---\n");

// 长 prompt 下模型偶发吐错条数/坏 JSON（非截断），重试后二分拆批兜底
async function scoreBatch(SYSTEM, batch, depth = 0) {
  for (let a = 0; a < (depth === 0 ? 4 : 3); a++) {
    try {
      const out = await chatJson(SYSTEM, renderList(batch));
      if (!Array.isArray(out.items) || out.items.length !== batch.length)
        throw new Error(`length ${out.items?.length}/${batch.length}`);
      batch.forEach((r, j) => {
        const e = out.items[j] ?? {};
        r.newScore = Math.max(
          0,
          Math.min(100, Math.round(Number(e.score)) || 0),
        );
        r.newGist =
          typeof e.gist === "string" && e.gist.trim()
            ? e.gist.trim().slice(0, MAX_GIST)
            : null;
      });
      return;
    } catch (err) {
      console.error(`  batch(n=${batch.length}) retry ${a}: ${err.message}`);
      await sleep(1200 * (a + 1));
    }
  }
  if (batch.length > 4) {
    const mid = Math.ceil(batch.length / 2);
    await scoreBatch(SYSTEM, batch.slice(0, mid), depth + 1);
    await scoreBatch(SYSTEM, batch.slice(mid), depth + 1);
    return;
  }
  batch.forEach((r) => {
    r.newScore = null;
    r.newGist = null;
  });
}

async function main() {
  if (APPLY) {
    const decisions = JSON.parse(readFileSync(FROM_FILE, "utf8"));
    const flips = decisions.filter((d) => d.flip);
    console.log(
      `apply: ${flips.length} 条待回捞（来自 ${FROM_FILE}，不重跑模型）`,
    );
    let done = 0,
      skipped = 0;
    for (const d of flips) {
      // 仍是 rejected 才改：幂等，且避免覆盖期间被人工/管线改过的行
      const res = await d1Remote(
        `UPDATE news_items SET status = 'pending', relevance_score = ?, gist = COALESCE(?, gist)
         WHERE id = ? AND status = 'rejected'`,
        [d.newScore, d.newGist, d.id],
      );
      void res;
      const check = await d1Remote(
        `SELECT status, relevance_score AS score FROM news_items WHERE id = ?`,
        [d.id],
      );
      if (check[0]?.status === "pending") done++;
      else {
        skipped++;
        console.error(`  跳过 ${d.id}（当前 status=${check[0]?.status}）`);
      }
    }
    console.log(`回捞完成: ${done} 条已置 pending, ${skipped} 条跳过`);
    console.log(
      "下一轮 cron 会 embed + cluster 这些条目；无需重启，也不会被重新打分。",
    );
    return;
  }

  const SYSTEM = liveFilterSystem();
  console.log(`使用 src/lib/news/ai.ts 的线上 prompt（${SYSTEM.length} 字符）`);
  const rows = await d1Remote(
    `SELECT ni.id, ni.relevance_score AS oldScore, ns.name AS src, ni.title, ni.excerpt,
            datetime(ni.published_at, 'unixepoch') AS pub
     FROM news_items ni JOIN news_sources ns ON ns.id = ni.source_id
     WHERE ni.status = 'rejected' AND ni.fetched_at >= strftime('%s','now') - ?
     ORDER BY ni.fetched_at DESC`,
    [HOURS * 3600],
  );
  console.log(`近 ${HOURS}h 内 rejected 条目: ${rows.length}`);
  if (rows.length === 0) return;

  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH)
    batches.push(rows.slice(i, i + BATCH));
  let n = 0;
  for (let i = 0; i < batches.length; i += CONC) {
    await Promise.all(
      batches.slice(i, i + CONC).map(async (b) => {
        await scoreBatch(SYSTEM, b);
        console.error(`batch ${++n}/${batches.length}`);
      }),
    );
  }

  const decisions = rows.map((r) => ({
    id: r.id,
    src: r.src,
    pub: r.pub,
    title: clean(r.title).slice(0, 100),
    oldScore: r.oldScore,
    newScore: r.newScore,
    newGist: r.newGist,
    flip: r.newScore != null && r.newScore >= THRESHOLD,
  }));
  writeFileSync(OUT, JSON.stringify(decisions, null, 1));

  const flips = decisions.filter((d) => d.flip);
  const failed = decisions.filter((d) => d.newScore == null);
  console.log(`\n=== DRY RUN（未写库）===`);
  console.log(
    `将回捞 ${flips.length}/${rows.length} 条（新分 >= ${THRESHOLD}）；打分失败 ${failed.length} 条`,
  );
  const bySrc = {};
  flips.forEach((d) => {
    bySrc[d.src] = (bySrc[d.src] || 0) + 1;
  });
  console.log(
    `按来源: ${Object.entries(bySrc)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
  for (const d of flips.sort((a, b) => b.newScore - a.newScore))
    console.log(
      `  ${String(d.oldScore).padStart(2)}→${d.newScore}  [${d.src}] ${d.title.slice(0, 62)}`,
    );
  console.log(`\n决策已写入 ${OUT}`);
  console.log(`人工复核后执行: node scripts/backfill-rescore-rejected.mjs --apply --from-file ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
