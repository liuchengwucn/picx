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
 *     内置了一次整体重探来压掉抖动，但人工复核仍是必要的一环。）
 *   - 判决 skip = **库里当前那张**探成 unreachable（TLS/DNS/超时，连 HTTP 响应都没拿到）。
 *     这类一律不写库：workerd/undici 连不上 ≠ 浏览器加载不了（缺中间证书的 latepost.com
 *     实测就是这样），那张图正在页面上正常显示，动它只有风险没有收益。
 *     判据的完整四条与「为什么第 2 条看的是库里那张」见主循环内的注释。
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
 *   --sleep MS          每条 story 之间的间隔，默认 300ms（别把图床打挂）。
 *                       注意它只作用于 story **之间**：单条 story 最坏要探 4（首轮）
 *                       + 4（全挂重探）+ 1（判据第 2 条探库里那张）= 9 次探活、
 *                       最多 36 次网络请求，且多半打在同一个图床上。真跑遇到限流时，
 *                       这里是第一嫌疑人——把 --sleep 调大，或给探活之间也加间隔。
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

// D1 单查询绑定参数上限 100，story_id IN (...) 每个 id 占一个，留足余量
const MEMBER_QUERY_CHUNK = 90;

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

/**
 * 复用 cron 的候选筛选（去重 + 上限 4）后逐张探活。
 * 返回第一张 `ok` 的 media，外加所有判成 `unreachable` 的候选（供 skip 判定与打印）。
 */
async function pick(members) {
  const unreachable = [];
  for (const media of leadImageCandidates(members)) {
    const verdict = await probeNewsImage(media.url);
    if (verdict === "ok") return { picked: media, unreachable };
    if (verdict === "unreachable") unreachable.push(media);
  }
  return { picked: null, unreachable };
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

// 成员 media 批量载入，按 story 分组：逐条查会多打上百次 D1 REST 往返。
// 只取 targets 的成员——media JSON 可达数 KB/行，全量拉会让响应体量随存量线性增长，
// 而 --limit 2 的试跑本该是廉价的。分批是因为 D1 单查询绑定参数上限 100。
// ORDER BY published_at 与 summarize 阶段的成员顺序一致。
const mediaByStory = new Map();
for (let i = 0; i < targets.length; i += MEMBER_QUERY_CHUNK) {
  const ids = targets.slice(i, i + MEMBER_QUERY_CHUNK).map((s) => s.id);
  const memberRows = await d1(
    `SELECT story_id AS storyId, media
     FROM news_items
     WHERE story_id IN (${ids.map(() => "?").join(",")})
     ORDER BY story_id, published_at`,
    ids,
  );
  for (const row of memberRows) {
    const list = mediaByStory.get(row.storyId) ?? [];
    list.push({ media: parseJson(row.media, null) });
    mediaByStory.set(row.storyId, list);
  }
}

const stats = {
  total: targets.length,
  changed: 0,
  // changed 的子集：换上去的那张是 unreachable（判据第 3 条的 fail-open），不是探活 ok
  failopen: 0,
  cleared: 0,
  kept: 0,
  skipped: 0,
};
const changedIds = [];
for (const [i, story] of targets.entries()) {
  const current = parseJson(story.leadImage, null);
  const members = mediaByStory.get(story.id) ?? [];
  const candidates = leadImageCandidates(members);
  let { picked, unreachable } = await pick(members);
  // 一张都没通过 → 整体重探一次再定罪。探活打的是外网，单次全挂很可能只是网络抖动，
  // 而「置 NULL」是不可逆的信息丢失（media 还在，但下次重跑要重新探）。
  if (!picked && candidates.length > 0) {
    await sleep(SLEEP_MS);
    ({ picked, unreachable } = await pick(members));
  }

  const before = current?.url ?? null;

  // 判据四条，顺序即优先级：
  //   1. 有候选 ok         ⇒ 采用第一个 ok（与库里同一张记 keep，不同则 swap）
  //   2. 否则，**库里当前那张**探成 unreachable ⇒ skip，不写库
  //   3. 否则，有候选 unreachable ⇒ 采用第一个（与 cron 同语义：可能显示 > 确证 403）
  //   4. 否则（全 rejected） ⇒ 置 NULL
  //
  // 第 2 条看的是库里那张而不是"候选集里有没有 unreachable"，两者在混合场景会分岔：
  // 候选 [#1 rejected(403), #2 unreachable] 且库里存的正是 #1 时，按候选集判会 skip，
  // 等于把一张**已确证 403 的坏图**原样留着。而"不要动它"的理由——它可能正在浏览器里
  // 好好显示（workerd 连不上 ≠ 浏览器加载不了）——只对 unreachable 的那张成立。
  // 注意库里那张未必在候选列表里（候选是按新规则重算的），所以这里要单独探一次。
  let chosen = picked;
  let verdict;
  if (!chosen) {
    const currentVerdict = before ? await probeNewsImage(before) : "rejected";
    if (currentVerdict === "unreachable") {
      verdict = "skip";
      stats.skipped++;
    } else if (currentVerdict === "ok") {
      // 库里那张自己探得通，只是没进新算出的前 4 个候选（成员事后加入让排序前移、
      // 或某成员的 media JSON 变脏被吞成 null 都会造成这种错位）。置 NULL 是不可逆的
      // 信息丢失，而这张图刚刚被证实能加载——留着它，别拿"它不在候选里"当处决理由。
      verdict = "keep";
      stats.kept++;
    } else {
      chosen = unreachable[0] ?? null;
    }
  }

  const after = chosen?.url ?? null;
  if (!verdict) {
    if (after && after === before) {
      verdict = "keep";
      stats.kept++;
    } else if (after) {
      verdict = "swap";
      stats.changed++;
      // 只在真的换了图时才算 fail-open，否则 failopen 会跑出 changed 的范围
      if (!picked) stats.failopen++;
    } else {
      verdict = "null";
      stats.cleared++;
    }
  }
  if (verdict === "swap" || verdict === "null") changedIds.push(story.shortId);

  console.log(
    `[${i + 1}/${targets.length}] ${story.shortId} ${verdict}\n` +
      `    before: ${before ?? "(none)"}\n` +
      `    after : ${after ?? (verdict === "skip" ? "(unchanged)" : "(NULL)")}\n` +
      `    title : ${(story.title ?? "").slice(0, 90)}` +
      unreachable
        .map((media) => `\n    net   : ${media.url} → unreachable`)
        .join(""),
  );

  if (APPLY && (verdict === "swap" || verdict === "null")) {
    try {
      await d1(
        `UPDATE news_stories SET lead_image = ?, updated_at = ? WHERE id = ?`,
        [
          chosen ? JSON.stringify(chosen) : null,
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
    `keep=${stats.kept} swap=${stats.changed}（其中 fail-open=${stats.failopen}） ` +
    `cleared=${stats.cleared} skipped=${stats.skipped}（库里那张连不上，未改动）`,
);
if (DRY_RUN && changedIds.length > 0) {
  console.log(
    `[backfill-lead-images] 复核后把下列 short_id 存成文件，再跑 --ids-file <file> --apply：\n${changedIds.join("\n")}`,
  );
}
