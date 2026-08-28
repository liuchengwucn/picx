#!/usr/bin/env node
/**
 * 回填 news_items.published_at：把「只有日期、时分秒被补成零点」的发布时间修正为
 * 首次抓到的时刻。
 *
 * 为什么要跑：不少源的 feed 不给时分秒，生成 feed 的一方补成当日零点（Anthropic
 * 镜像 feed 12 条全是 `00:00:00 +0000`；RSSHub 的腾讯混元路由出 `16:00:00 GMT`
 * = 北京时间当日零点）。于是一条当天上午发布、当天下午抓到的新闻在 /news 上显示
 * 「15 小时前」。cron 侧已改（fetchStage 入库前过 lib/news/published-at.ts 的
 * refinePublishedAt），本脚本只管存量。
 *
 * 判据与写入规则直接复用生产代码，不复制一份——两边错开会选出不同的候选集。
 *
 * 安全性：
 *   - 默认 dry-run，只打印将要做的改动，一行不写库。
 *   - 幂等可重入：修正后的时间戳不再落在半点网格上，重跑不会再次命中自己；
 *     D1 无事务，逐条 UPDATE，中断后重跑只处理剩下的。
 *   - 不可自动回滚：原值是源给的零点，改完就没了。需要留底的话先跑一次
 *     `--json out.json` 把 (id, 旧值) 存下来。
 *
 * 顺序要求：**先部署带 refinePublishedAt 的 worker，再跑回填。** 反过来的话，
 * 回填期间线上旧 fetchStage 仍在按零点写新条目，跑完立刻又有脏数据。
 *
 * 跑完还要做第二步：本脚本只改条目，story 的事件锚点是从成员 publishedAt 算出来
 * 的，不会自己跟着变（列表排序与分日分组都读它）。接着跑：
 *   mac npx tsx scripts/backfill-story-event-date.mjs --apply
 *
 * 用法（在宿主 mac 侧跑）：
 *   mac npx tsx scripts/backfill-date-only-published-at.mjs             # dry-run 全量
 *   mac npx tsx scripts/backfill-date-only-published-at.mjs --limit 20  # dry-run 前 20 条
 *   mac npx tsx scripts/backfill-date-only-published-at.mjs --apply     # 真正写库
 *   mac npx tsx scripts/backfill-date-only-published-at.mjs --json bak.json  # 顺带留底
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFeed } from "../src/lib/news/adapters/rss.ts";
import { fetchRsshub } from "../src/lib/news/adapters/rsshub.ts";
import {
  pickDateOnlyOffsets,
  refinePublishedAt,
} from "../src/lib/news/published-at.ts";

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
const JSON_OUT = getOpt("--json", "");
// Number('ten') = NaN 会静默变成「无限制」，谨慎的试跑反而全量执行 —— 显式校验
const LIMIT = Number(getOpt("--limit", "0"));
if (!Number.isInteger(LIMIT) || LIMIT < 0) {
  console.error("[backfill-date-only] --limit 需要是非负整数");
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
    "[backfill-date-only] .dev.vars 缺 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / CLOUDFLARE_D1_DATABASE_ID",
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

/**
 * 抓活 feed 定该源的零点偏移，与线上 fetchStage 看到的样本一致。
 * 抓不到（源挂了 / 403 / 无 RSSHub 配置）返回空集，交由调用方退回存量分布。
 * HN 走 API 且时间戳是真实秒级，没有补零点这回事，直接跳过。
 */
async function liveOffsets(source) {
  if (!source || source.type === "hn") return new Set();
  try {
    const items =
      source.type === "rss"
        ? source.config.url
          ? await fetchFeed(source.config.url)
          : []
        : E.RSSHUB_BASE_URL
          ? await fetchRsshub(
              E.RSSHUB_BASE_URL,
              source.config,
              E.RSSHUB_ACCESS_KEY,
            )
          : [];
    return pickDateOnlyOffsets(items.map((i) => i.publishedAt));
  } catch (error) {
    console.warn(
      `[backfill-date-only] ${source.id}: 活 feed 抓取失败（${error.message.slice(
        0,
        60,
      )}），退回存量分布`,
    );
    return new Set();
  }
}

const SHANGHAI = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  dateStyle: "short",
  timeStyle: "medium",
});
const fmt = (date) => `${SHANGHAI.format(date)} CST`;
const hours = (ms) => (ms / 3_600_000).toFixed(1);

// ---------- main ----------
async function main() {
  // 判据要看「源 × 日内秒偏移」的分布，所以按源整批取。线上取样的是当轮 feed，
  // 这里取样的是该源入库的全部存量——同一个 pickDateOnlyOffsets，同一条线。
  const rows = await d1(
    `SELECT id, source_id, story_id, title, published_at, fetched_at
       FROM news_items
      ORDER BY source_id, published_at DESC`,
  );

  const bySourceRows = new Map();
  for (const row of rows) {
    const list = bySourceRows.get(row.source_id) ?? [];
    list.push(row);
    bySourceRows.set(row.source_id, list);
  }

  const sources = await d1(`SELECT id, type, config FROM news_sources`);
  const sourceById = new Map(
    sources.map((s) => [s.id, { ...s, config: JSON.parse(s.config) }]),
  );

  const changes = [];
  for (const [sourceId, list] of bySourceRows) {
    // 活 feed 优先：库里只留了摄入窗口内的条目，样本可能薄到判不出来（腾讯混元
    // 存量仅 2 条，而活 feed 8 条里 4 条落在北京时间零点）。抓不到就退回存量分布，
    // 两者取并集——线上判据看的就是活 feed，回填漏掉的正好是最新那批。
    const live = await liveOffsets(sourceById.get(sourceId));
    const stored = pickDateOnlyOffsets(
      list.map((r) => new Date(r.published_at * 1000)),
    );
    const offsets = new Set([...live, ...stored]);
    if (offsets.size === 0) continue;
    console.log(
      `[backfill-date-only] ${sourceId}: 存量 ${list.length} 条，零点偏移 ${[
        ...offsets,
      ]
        .map(
          (s) =>
            `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(
              Math.floor((s % 3600) / 60),
            ).padStart(2, "0")}Z${live.has(s) ? "" : "(仅存量)"}`,
        )
        .join(" ")}`,
    );
    for (const row of list) {
      const published = new Date(row.published_at * 1000);
      const fetched = new Date(row.fetched_at * 1000);
      const next = refinePublishedAt(published, fetched, offsets);
      if (next.getTime() === published.getTime()) continue;
      changes.push({
        id: row.id,
        sourceId,
        storyId: row.story_id,
        title: row.title,
        oldTs: row.published_at,
        newTs: Math.floor(next.getTime() / 1000),
        old: published,
        next,
      });
    }
  }
  changes.sort((a, b) => b.oldTs - a.oldTs);

  const targets = LIMIT > 0 ? changes.slice(0, LIMIT) : changes;
  console.log(
    `[backfill-date-only] 扫描 ${rows.length} 条 → 需修正 ${changes.length} 条` +
      (LIMIT > 0 ? `（--limit ${LIMIT}，本次处理 ${targets.length} 条）` : "") +
      (DRY_RUN ? "  [dry-run]" : "  [apply]"),
  );

  const bySource = new Map();
  for (const c of targets) {
    bySource.set(c.sourceId, (bySource.get(c.sourceId) ?? 0) + 1);
  }
  console.log(
    `[backfill-date-only] 按来源：${[...bySource]
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${s}=${n}`)
      .join(", ")}`,
  );

  if (JSON_OUT) {
    writeFileSync(
      JSON_OUT,
      JSON.stringify(
        targets.map((c) => ({ id: c.id, published_at: c.oldTs })),
        null,
        2,
      ),
    );
    console.log(`[backfill-date-only] 旧值已留底到 ${JSON_OUT}`);
  }

  const affectedStories = new Set();
  let written = 0;
  for (const c of targets) {
    if (c.storyId) affectedStories.add(c.storyId);
    console.log(
      `  ${c.sourceId}  ${fmt(c.old)} → ${fmt(c.next)}  (+${hours(
        c.next - c.old,
      )}h)  ${c.title.slice(0, 60)}`,
    );
    if (DRY_RUN) continue;
    await d1(`UPDATE news_items SET published_at = ? WHERE id = ?`, [
      c.newTs,
      c.id,
    ]);
    written++;
  }

  console.log(
    `[backfill-date-only] ${DRY_RUN ? "将改写" : "已改写"} ${
      DRY_RUN ? targets.length : written
    } 条，涉及 ${affectedStories.size} 条 story`,
  );
  if (affectedStories.size > 0) {
    console.log(
      "[backfill-date-only] 第二步（story 事件锚点不会自己跟着变）：" +
        "mac npx tsx scripts/backfill-story-event-date.mjs --apply",
    );
  }
  if (DRY_RUN) {
    console.log("[backfill-date-only] dry-run 结束，加 --apply 才会写库");
  }
}

main().catch((error) => {
  console.error("[backfill-date-only] 失败:", error);
  process.exit(1);
});
