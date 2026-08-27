#!/usr/bin/env node
/**
 * 回填 news_stories.earliest_published_at 为新语义「事件锚点」（主导报道簇的起始时间）。
 *
 * 为什么要跑：该列旧语义是「成员最早发布时间」，一条几天前的前置报道会把整条 story
 * 钉死在起源日，在 /news 的「每日热点」里彻底消失（生产案例 7ye5bB：1 条 8/23 前置
 * 报道 + 5 条 8/26 发布报道 → 被归到 8/23）。cron 侧已改（summarize 用
 * lib/news/event-date.ts 的 pickEventPublishedAt），本脚本只管存量。
 *
 * 算法直接复用生产代码，不复制一份，免得回填结果和下一轮 summarize 打架。
 *
 * 列名刻意不改：RENAME COLUMN 会在迁移与部署之间的窗口里让线上 news 查询全部 500。
 *
 * 安全性：
 *   - 默认 dry-run，只打印将要做的改动，一行不写库。
 *   - 幂等可重入：只按当前库里的成员条目重算，中断后重跑结果一致；D1 无事务，逐条 UPDATE。
 *   - 可逆：恢复旧语义重跑 drizzle/0021_add_story_earliest_published.sql 里那条 UPDATE 即可
 *     （UPDATE news_stories SET earliest_published_at = COALESCE(
 *        (SELECT MIN(published_at) FROM news_items WHERE news_items.story_id = news_stories.id),
 *        first_seen_at)）。
 *
 * 用法（在宿主 mac 侧跑）：
 *   mac npx tsx scripts/backfill-story-event-date.mjs            # dry-run 全量
 *   mac npx tsx scripts/backfill-story-event-date.mjs --limit 20 # dry-run 前 20 条
 *   mac npx tsx scripts/backfill-story-event-date.mjs --apply    # 真正写库
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BURST_GAP_HOURS,
  pickEventPublishedAt,
} from "../src/lib/news/event-date.ts";

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
// Number('ten') = NaN 会静默变成「无限制」，谨慎的试跑反而全量执行 —— 显式校验
const LIMIT = Number(getOpt("--limit", "0"));
if (!Number.isInteger(LIMIT) || LIMIT < 0) {
  console.error("[backfill-story-event-date] --limit 需要是非负整数");
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
    "[backfill-story-event-date] .dev.vars 缺 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / CLOUDFLARE_D1_DATABASE_ID",
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

// D1 单查询绑定参数上限 100，story_id IN (...) 每个 id 占一个，留足余量
const MEMBER_QUERY_CHUNK = 90;

const SHANGHAI_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const fmtDay = (date) => SHANGHAI_DAY.format(date);

/**
 * 展示用：把成员按 BURST_GAP_HOURS 重新切簇，产出「3条/220分@2026-08-13」这样的形状串。
 * 仅用于打印，不参与决策——真正的选值全部来自 pickEventPublishedAt。
 */
function describeBursts(members) {
  const sorted = [...members].sort(
    (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime(),
  );
  const gapMs = BURST_GAP_HOURS * 60 * 60 * 1000;
  const bursts = [];
  let current = [];
  let prev = null;
  for (const m of sorted) {
    if (prev && m.publishedAt.getTime() - prev.publishedAt.getTime() > gapMs) {
      bursts.push(current);
      current = [];
    }
    current.push(m);
    prev = m;
  }
  bursts.push(current);
  return bursts
    .map((burst) => {
      const score = burst.reduce((acc, m) => acc + (m.relevanceScore ?? 60), 0);
      return `${burst.length}条/${score}分@${fmtDay(burst[0].publishedAt)}`;
    })
    .join(" | ");
}

// ---------- main ----------
const stories = await d1(
  `SELECT id, short_id AS shortId, earliest_published_at AS earliestPublishedAt
   FROM news_stories
   ORDER BY last_activity_at DESC${LIMIT > 0 ? ` LIMIT ${LIMIT}` : ""}`,
);

console.log(
  `[backfill-story-event-date] ${stories.length} 条 story 待重算。${
    DRY_RUN ? "DRY RUN —— 加 --apply 才写库" : "APPLY —— 会写库"
  }`,
);
if (stories.length === 0) process.exit(0);

// 成员分批载入：D1 单查询绑定参数上限 100
const membersByStory = new Map();
for (let i = 0; i < stories.length; i += MEMBER_QUERY_CHUNK) {
  const ids = stories.slice(i, i + MEMBER_QUERY_CHUNK).map((s) => s.id);
  const rows = await d1(
    `SELECT story_id AS storyId, published_at AS publishedAt, relevance_score AS relevanceScore
     FROM news_items
     WHERE story_id IN (${ids.map(() => "?").join(",")})
     ORDER BY published_at`,
    ids,
  );
  for (const row of rows) {
    const list = membersByStory.get(row.storyId) ?? [];
    // D1 的时间戳列存 unix 秒，pickEventPublishedAt 收 Date —— 这里 *1000 是唯一入口
    list.push({
      publishedAt: new Date(row.publishedAt * 1000),
      relevanceScore: row.relevanceScore,
    });
    membersByStory.set(row.storyId, list);
  }
}

const stats = { total: stories.length, orphans: 0, changed: 0 };

for (const [i, story] of stories.entries()) {
  const members = membersByStory.get(story.id) ?? [];
  if (members.length === 0) {
    stats.orphans++;
    continue;
  }

  const newDate = pickEventPublishedAt(members);
  if (!newDate) {
    stats.orphans++;
    continue;
  }
  // D1 的时间戳列存 unix 秒 —— 写回时 /1000 取整，与读入的 *1000 互为逆操作
  const newValue = Math.floor(newDate.getTime() / 1000);
  const oldValue = story.earliestPublishedAt;

  if (newValue === oldValue) continue;

  stats.changed++;
  console.log(
    `${story.shortId}  ${fmtDay(new Date(oldValue * 1000))} -> ${fmtDay(newDate)}   ${describeBursts(members)}`,
  );

  if (APPLY) {
    try {
      await d1(
        `UPDATE news_stories SET earliest_published_at = ? WHERE id = ?`,
        [newValue, story.id],
      );
    } catch (error) {
      // 单条失败不中断：脚本可重入，重跑会再算一遍这条
      console.error(`    ✗ update failed: ${String(error).slice(0, 200)}`);
    }
  }
}

console.log(
  `[backfill-story-event-date] 扫描 ${stats.total} 条 / 无成员跳过 ${stats.orphans} 条 / 变更 ${stats.changed} 条`,
);
if (DRY_RUN) {
  console.log("[backfill-story-event-date] DRY-RUN：未写库");
}
