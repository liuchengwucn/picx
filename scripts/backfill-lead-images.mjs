#!/usr/bin/env node
/**
 * 清洗存量 news_stories.lead_image：对每条候选 story 重跑「探活 + 顺延下一张候选」，
 * 把加载不出来的封面图换成同 story 里真能加载的那张，都不行则置 NULL。
 *
 * 为什么要跑：summarize 阶段过去只做 URL 正则过滤、从不验证可达性，
 * 线上 84 条带 leadImage 的 story 里 57 条（68%）落在防盗链图床
 * （image.jiqizhixin.com / i.qbitai.com）上，首页头条渲染成「加载失败」空图框。
 * cron 侧已修（src/workers/news-cron.ts 的 pickLeadImage），本脚本只管存量。
 *
 * 选图逻辑直接复用生产代码（leadImageCandidates + probeNewsImage），不复制一份，
 * 免得回填结果和 cron 下一轮重算的结果打架。
 *
 * 安全性：
 *   - 默认 dry-run，只打印将要做的改动，一行不写库。
 *   - 幂等可重入：只按当前库里的 media 重算，中断后重跑结果一致；D1 无事务，逐条 UPDATE。
 *   - 正确流程是 dry-run → 人工复核输出 → 把要改的 short_id 存成文件 → --ids-file X --apply。
 *     不要 dry-run 完直接全量 --apply：探活打的是外网，单次失败可能是网络抖动而非防盗链，
 *     全量 apply 会把抖动直接写成 NULL。（脚本对「全部候选都挂 → 置 NULL」这一种情况
 *     内置了一次整体重探 + 连通性体检来压掉抖动和本机环境问题，但人工复核仍是必要的一环。）
 *   - 判决 skip = 候选图在本机连都连不上（TLS/DNS/超时），一律不写库（见 reachable）。
 *
 * 代理陷阱（重要）：**不要**带 NODE_USE_ENV_PROXY=1 跑本脚本。
 * 宿主的 http_proxy 是海外出口，国内图床（jiqizhixin / qbitai）经它出去会返回假 403，
 * 探活于是把一批本来好好的图判死。调查阶段已经被这个坑误判过一次结论。
 *
 * 用法（在宿主 mac 侧跑）：
 *   npx tsx scripts/backfill-lead-images.mjs                       # dry-run 全量
 *   npx tsx scripts/backfill-lead-images.mjs --limit 20            # dry-run 前 20 条
 *   npx tsx scripts/backfill-lead-images.mjs --ids-file ids.txt --apply
 *
 * 参数：
 *   --apply             真正写库（不带则 dry-run）
 *   --ids-file <path>   只处理文件里列出的 short_id（每行一个），配合 --apply 使用
 *   --limit N           只取前 N 条 story（按 last_activity_at 倒序）
 *   --sleep MS          每条 story 之间的间隔，默认 300ms（别把图床打挂）
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeNewsImage } from "../src/lib/news/image-source.ts";
import { leadImageCandidates } from "../src/workers/news-cron.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// ---------- args ----------
const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getOpt = (f, def) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const APPLY = hasFlag("--apply");
const DRY_RUN = !APPLY;
const IDS_FILE = getOpt("--ids-file", "");
// Number('ten') = NaN 会静默变成「无限制」，谨慎的试跑反而全量执行 —— 显式校验
const LIMIT = Number(getOpt("--limit", "0"));
const SLEEP_MS = Number(getOpt("--sleep", "300"));
if (!Number.isInteger(LIMIT) || LIMIT < 0 || !Number.isFinite(SLEEP_MS)) {
  console.error("[backfill-lead-images] --limit / --sleep 需要是数字");
  process.exit(1);
}

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
if (!ACCOUNT_ID || !API_TOKEN || !DB_ID) {
  console.error(
    "[backfill-lead-images] .dev.vars 缺 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / CLOUDFLARE_D1_DATABASE_ID",
  );
  process.exit(1);
}

async function d1(sql, params = []) {
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
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data.errors ?? data)}`);
  }
  return data.result[0]?.results ?? [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** D1 的 JSON 列取回来是字符串；脏数据（非法 JSON）当成空值处理而不是让整轮崩掉。 */
function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** 复用 cron 的候选筛选（去重 + 上限 4）后逐张探活，返回第一张通过的 media。 */
async function pick(members) {
  for (const media of leadImageCandidates(members)) {
    if (await probeNewsImage(media.url)) return media;
  }
  return null;
}

/**
 * 连通性体检：只区分「上游给出了 HTTP 响应」和「传输层就没连上」，不判断图好不好。
 *
 * 为什么需要它：probeNewsImage 把所有异常都吞成 false（对 cron 是对的——存疑即淘汰，
 * 下轮还能重来），但回填要把「上游真的拒绝」和「本机环境问题」分开，两者的正确处置相反。
 * 实证：www.latepost.com 的证书链缺中间证书，浏览器和 curl 靠 AIA 补链能正常加载，
 * Node 的 undici 不补链，直接抛 "unable to get local issuer certificate"。
 * 若照单全收，这一跑就会把 4 条 latepost 好图误清成 NULL。
 * 所以：只要有候选是「连都连不上」，本条 story 一律跳过不写。
 */
async function reachable(url) {
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel().catch(() => {});
    return { ok: true, detail: `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, detail: String(error.cause ?? error).slice(0, 160) };
  }
}

// ---------- main ----------
const stories = await d1(
  `SELECT id, short_id AS shortId, lead_image AS leadImage,
          json_extract(title, '$.en') AS title
   FROM news_stories
   WHERE status != 'hidden' AND lead_image IS NOT NULL
   ORDER BY last_activity_at DESC${LIMIT > 0 ? ` LIMIT ${LIMIT}` : ""}`,
);

let targets = stories;
if (IDS_FILE) {
  const wanted = new Set(
    readFileSync(IDS_FILE, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  targets = stories.filter((s) => wanted.has(s.shortId));
  const missing = [...wanted].filter(
    (id) => !stories.some((s) => s.shortId === id),
  );
  if (missing.length > 0) {
    // 通常意味着这条 story 已被隐藏，或 lead_image 已经是 NULL（上一轮跑过了）——不是错误
    console.warn(
      `[backfill-lead-images] ids-file 里有 ${missing.length} 个 short_id 不在目标集内，已跳过: ${missing.join(", ")}`,
    );
  }
}

console.log(
  `[backfill-lead-images] ${targets.length} 条待检查 story（本次取回 ${stories.length} 条带 lead_image）。${
    DRY_RUN ? "DRY RUN —— 加 --apply 才写库" : "APPLY —— 会写库"
  }`,
);
if (targets.length === 0) process.exit(0);

// 成员 media 一次性载入，按 story 分组。逐条查会多打上百次 D1 REST 往返，
// 而这批数据总量只有几百行。ORDER BY published_at 与 summarize 阶段的成员顺序一致。
const memberRows = await d1(
  `SELECT i.story_id AS storyId, i.media AS media
   FROM news_items i
   JOIN news_stories s ON s.id = i.story_id
   WHERE s.status != 'hidden' AND s.lead_image IS NOT NULL
   ORDER BY i.story_id, i.published_at`,
);
const mediaByStory = new Map();
for (const row of memberRows) {
  const list = mediaByStory.get(row.storyId) ?? [];
  list.push({ media: parseJson(row.media, null) });
  mediaByStory.set(row.storyId, list);
}

const stats = {
  total: targets.length,
  ok: 0,
  changed: 0,
  cleared: 0,
  kept: 0,
  skipped: 0,
};
const changedIds = [];
for (const [i, story] of targets.entries()) {
  const current = parseJson(story.leadImage, null);
  const members = mediaByStory.get(story.id) ?? [];
  const candidates = leadImageCandidates(members);
  let picked = await pick(members);
  // 一张都没通过 → 整体重探一次再定罪。探活打的是外网，单次全挂很可能只是网络抖动，
  // 而「置 NULL」是不可逆的信息丢失（media 还在，但下次重跑要重新探）。
  if (!picked && candidates.length > 0) {
    await sleep(SLEEP_MS);
    picked = await pick(members);
  }
  // 仍然全挂 → 先做连通性体检，本机连不上的一律跳过（见 reachable 的注释）
  const transportIssues = [];
  if (!picked) {
    for (const media of candidates) {
      const health = await reachable(media.url);
      if (!health.ok) transportIssues.push(`${media.url} → ${health.detail}`);
    }
  }

  const before = current?.url ?? null;
  const after = picked?.url ?? null;
  let verdict;
  if (after && after === before) {
    verdict = "keep";
    stats.kept++;
    stats.ok++;
  } else if (after) {
    verdict = "swap";
    stats.changed++;
    stats.ok++;
  } else if (transportIssues.length > 0) {
    verdict = "skip";
    stats.skipped++;
  } else {
    verdict = "null";
    stats.cleared++;
  }
  if (verdict === "swap" || verdict === "null") changedIds.push(story.shortId);

  console.log(
    `[${i + 1}/${targets.length}] ${story.shortId} ${verdict}\n` +
      `    before: ${before ?? "(none)"}\n` +
      `    after : ${after ?? (verdict === "skip" ? "(unchanged)" : "(NULL)")}\n` +
      `    title : ${(story.title ?? "").slice(0, 90)}` +
      transportIssues.map((line) => `\n    net   : ${line}`).join(""),
  );

  if (APPLY && (verdict === "swap" || verdict === "null")) {
    try {
      await d1(
        `UPDATE news_stories SET lead_image = ?, updated_at = ? WHERE id = ?`,
        [
          picked ? JSON.stringify(picked) : null,
          Math.floor(Date.now() / 1000), // D1 的时间戳列存 unix 秒
          story.id,
        ],
      );
    } catch (error) {
      // 单条失败不中断：脚本可重入，重跑会再算一遍这条
      console.error(`    ✗ update failed: ${String(error).slice(0, 200)}`);
    }
  }

  if (i < targets.length - 1) await sleep(SLEEP_MS);
}

console.log(
  `[backfill-lead-images] ${DRY_RUN ? "dry-run" : "applied"}: total=${stats.total} ` +
    `probe-ok=${stats.ok}（keep=${stats.kept} swap=${stats.changed}） cleared=${stats.cleared} ` +
    `skipped=${stats.skipped}（本机网络够不着，未改动）`,
);
if (DRY_RUN && changedIds.length > 0) {
  console.log(
    `[backfill-lead-images] 复核后把下列 short_id 存成文件，再跑 --ids-file <file> --apply：\n${changedIds.join("\n")}`,
  );
}
