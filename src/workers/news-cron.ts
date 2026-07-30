import { and, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { newsItems, newsSources, newsStories } from "#/db/schema";
import type { AIConfig } from "#/lib/ai";
import { fetchHn, fetchHnItemSignals } from "#/lib/news/adapters/hn";
import { fetchFeed } from "#/lib/news/adapters/rss";
import { fetchRsshub } from "#/lib/news/adapters/rsshub";
import {
  embedTexts,
  generateStoryContent,
  judgeAssignment,
  scoreRelevance,
} from "#/lib/news/ai";
import { buildSignalsSummary } from "#/lib/news/signals";
import type { NormalizedItem } from "#/lib/news/types";
import { hashUrl } from "#/lib/news/url";
import { cosineSimilarity, mergeCentroid } from "#/lib/news/vector";
import { generateShortId } from "#/lib/short-id";
import type { Env } from "#/types/env";

// 窗口/阈值都是产品参数，集中放这里便于调整（spec：72h 窗口可配置）
const CLUSTER_WINDOW_HOURS = 72;
const RELEVANCE_THRESHOLD = 55;
const SIM_CANDIDATE_THRESHOLD = 0.6;
const TOP_K = 5;
const FILTER_BATCH_SIZE = 25;
// 每轮各阶段上限：控制单次调用成本与时长；积压由后续轮次消化（有 log）
const MAX_FILTER_PER_ROUND = 150;
const MAX_EMBED_PER_ROUND = 100;
const MAX_CLUSTER_PER_ROUND = 60;
const MAX_SUMMARIZE_PER_ROUND = 30;
const MAX_HN_REFRESH_PER_ROUND = 50;
const MAX_SOURCE_FAILURES = 10;

type Db = DrizzleD1Database;

function log(step: string, message: string) {
  console.log(`[NewsCron][${step}] ${message}`);
}

function aiConfigFromEnv(env: Env): AIConfig {
  return {
    openaiApiKey: env.OPENAI_API_KEY,
    openaiBaseUrl: env.OPENAI_BASE_URL,
    openaiModel: env.NEWS_OPENAI_MODEL || env.OPENAI_MODEL,
    geminiApiKey: env.GEMINI_API_KEY,
    cfApiToken: env.CF_API_TOKEN,
  };
}

function windowStart(): Date {
  return new Date(Date.now() - CLUSTER_WINDOW_HOURS * 3600_000);
}

// ---- Stage 1: fetch ----

async function fetchForSource(
  source: typeof newsSources.$inferSelect,
  env: Env,
): Promise<NormalizedItem[]> {
  switch (source.type) {
    case "rss":
      return source.config.url ? fetchFeed(source.config.url) : [];
    case "rsshub":
      if (!env.RSSHUB_BASE_URL) {
        log("fetch", `skip ${source.id}: RSSHUB_BASE_URL not configured`);
        return [];
      }
      return fetchRsshub(env.RSSHUB_BASE_URL, source.config);
    case "hn":
      // HN 必须用宽回看窗（72h）：新帖需要时间攒分，短窗+分数阈值组合会永远抓不到内容
      // （实测 3h 窗口命中 0 条）。重复条目靠 urlHash onConflict 去重并回刷 signals。
      return fetchHn(source.config, windowStart());
  }
}

async function fetchStage(db: Db, env: Env): Promise<void> {
  const sources = await db
    .select()
    .from(newsSources)
    .where(eq(newsSources.enabled, true));
  for (const source of sources) {
    try {
      const items = await fetchForSource(source, env);
      let inserted = 0;
      for (const item of items) {
        // 单条容错：feed 里偶见坏 URL（hashUrl 会抛 TypeError），不能拖垮同来源其余条目
        let urlHash: string;
        try {
          urlHash = await hashUrl(item.url);
        } catch {
          log(
            "fetch",
            `${source.id}: skip invalid url ${item.url.slice(0, 120)}`,
          );
          continue;
        }
        const rows = await db
          .insert(newsItems)
          .values({
            sourceId: source.id,
            urlHash,
            url: item.url,
            title: item.title.slice(0, 500),
            excerpt: item.excerpt ?? null,
            author: item.author ?? null,
            publishedAt: item.publishedAt,
            signals: item.signals ?? null,
            media: item.media ?? null,
            extra: item.extra ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: newsItems.id });
        if (rows.length > 0) {
          inserted++;
        } else if (item.signals) {
          // 同一链接再次出现（如另一账号转发）：只回刷平台信号
          await db
            .update(newsItems)
            .set({ signals: item.signals })
            .where(eq(newsItems.urlHash, urlHash));
        }
      }
      await db
        .update(newsSources)
        .set({
          lastFetchedAt: new Date(),
          lastError: null,
          consecutiveFailures: 0,
        })
        .where(eq(newsSources.id, source.id));
      log("fetch", `${source.id}: ${items.length} fetched, ${inserted} new`);
    } catch (error) {
      const failures = source.consecutiveFailures + 1;
      await db
        .update(newsSources)
        .set({
          lastError: String(error).slice(0, 500),
          consecutiveFailures: failures,
          enabled: failures < MAX_SOURCE_FAILURES,
        })
        .where(eq(newsSources.id, source.id));
      console.error(
        `[NewsCron][fetch] ${source.id} failed (${failures}x):`,
        error,
      );
    }
  }
}

// ---- Stage 2: filter ----

async function filterStage(db: Db, env: Env): Promise<void> {
  const pending = await db
    .select({
      id: newsItems.id,
      title: newsItems.title,
      excerpt: newsItems.excerpt,
    })
    .from(newsItems)
    .where(
      and(eq(newsItems.status, "pending"), isNull(newsItems.relevanceScore)),
    )
    .limit(MAX_FILTER_PER_ROUND);
  if (pending.length === 0) return;

  for (let i = 0; i < pending.length; i += FILTER_BATCH_SIZE) {
    const batch = pending.slice(i, i + FILTER_BATCH_SIZE);
    const scores = await scoreRelevance(batch, aiConfigFromEnv(env));
    // 逐条更新即可：每轮 ≤150 条，远低于 D1 paid 档 1000 查询/次的限制
    for (let j = 0; j < batch.length; j++) {
      await db
        .update(newsItems)
        .set({
          relevanceScore: scores[j],
          status: scores[j] < RELEVANCE_THRESHOLD ? "rejected" : "pending",
        })
        .where(eq(newsItems.id, batch[j].id));
    }
  }
  log("filter", `scored ${pending.length} items`);
}

// ---- Stage 3: embed ----

async function embedStage(db: Db, env: Env): Promise<void> {
  const items = await db
    .select({
      id: newsItems.id,
      title: newsItems.title,
      excerpt: newsItems.excerpt,
    })
    .from(newsItems)
    .where(
      and(
        eq(newsItems.status, "pending"),
        gt(newsItems.relevanceScore, RELEVANCE_THRESHOLD - 1),
        isNull(newsItems.embedding),
      ),
    )
    .limit(MAX_EMBED_PER_ROUND);
  if (items.length === 0) return;

  const CHUNK = 20;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const vectors = await embedTexts(
      env.AI,
      chunk.map(
        (item) => `${item.title}\n${(item.excerpt ?? "").slice(0, 512)}`,
      ),
    );
    for (let j = 0; j < chunk.length; j++) {
      await db
        .update(newsItems)
        .set({ embedding: vectors[j] })
        .where(eq(newsItems.id, chunk[j].id));
    }
  }
  log("embed", `embedded ${items.length} items`);
}

// ---- Stage 4: cluster ----

async function clusterStage(db: Db, env: Env): Promise<void> {
  const items = await db
    .select()
    .from(newsItems)
    .where(
      and(
        eq(newsItems.status, "pending"),
        sql`${newsItems.embedding} is not null`,
      ),
    )
    .orderBy(newsItems.publishedAt)
    .limit(MAX_CLUSTER_PER_ROUND);
  if (items.length === 0) return;

  // 活跃 story 一次载入内存（每天几十个 story 量级，72h 窗口内远小于内存/行数限制）
  const active = await db
    .select({
      id: newsStories.id,
      title: newsStories.title,
      summary: newsStories.summary,
      centroid: newsStories.centroid,
      itemCount: newsStories.itemCount,
    })
    .from(newsStories)
    .where(
      and(
        eq(newsStories.status, "active"),
        gt(newsStories.lastActivityAt, windowStart()),
      ),
    );

  const config = aiConfigFromEnv(env);
  let merged = 0;
  let created = 0;

  for (const item of items) {
    const embedding = item.embedding as Float32Array;
    const scored = active
      .map((story) => ({
        story,
        sim: cosineSimilarity(embedding, story.centroid),
      }))
      .filter((entry) => entry.sim >= SIM_CANDIDATE_THRESHOLD)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, TOP_K);

    let target: (typeof active)[number] | null = null;
    if (scored.length > 0) {
      const idx = await judgeAssignment(
        { title: item.title, excerpt: item.excerpt },
        scored.map((entry) => ({
          // Record<string, string> 上 en 可能缺失（旧数据/异常），?? 兜底
          title: entry.story.title.en ?? "",
          summary: entry.story.summary.en ?? "",
        })),
        config,
      );
      if (idx !== null) target = scored[idx].story;
    }

    const now = new Date();
    if (target) {
      // D1 无事务：先更新 story 再更新 item；若中间崩溃，item 仍是 pending，下轮幂等重判
      const newCentroid = mergeCentroid(
        target.centroid,
        target.itemCount,
        embedding,
      );
      await db
        .update(newsStories)
        .set({
          centroid: newCentroid,
          itemCount: target.itemCount + 1,
          lastActivityAt: now,
          dirty: true,
          updatedAt: now,
        })
        .where(eq(newsStories.id, target.id));
      await db
        .update(newsItems)
        .set({ storyId: target.id, status: "clustered" })
        .where(eq(newsItems.id, item.id));
      target.centroid = newCentroid;
      target.itemCount += 1;
      merged++;
    } else {
      const [story] = await db
        .insert(newsStories)
        .values({
          shortId: generateShortId(),
          // 占位内容：summarize 阶段会用 LLM 覆盖为四语版本
          title: { en: item.title },
          summary: { en: item.excerpt ?? item.title },
          primaryItemId: item.id,
          centroid: embedding,
          itemCount: 1,
          sourceCount: 1,
          dirty: true,
          firstSeenAt: now,
          lastActivityAt: now,
        })
        .returning({ id: newsStories.id });
      await db
        .update(newsItems)
        .set({ storyId: story.id, status: "clustered" })
        .where(eq(newsItems.id, item.id));
      active.push({
        id: story.id,
        title: { en: item.title },
        summary: { en: item.excerpt ?? item.title },
        centroid: embedding,
        itemCount: 1,
      });
      created++;
    }
  }
  log(
    "cluster",
    `${items.length} items → ${merged} merged, ${created} new stories`,
  );
}

// ---- Stage 5: summarize ----

async function summarizeStage(db: Db, env: Env): Promise<void> {
  const dirtyStories = await db
    .select({ id: newsStories.id })
    .from(newsStories)
    // dirty 的 partial index 只认字面量谓词，不能用 eq()（绑定参数会退化为全表扫描）
    .where(and(sql`${newsStories.dirty} = 1`, eq(newsStories.status, "active")))
    .limit(MAX_SUMMARIZE_PER_ROUND);
  const config = aiConfigFromEnv(env);

  for (const { id } of dirtyStories) {
    try {
      const members = await db
        .select({
          title: newsItems.title,
          excerpt: newsItems.excerpt,
          url: newsItems.url,
          author: newsItems.author,
          signals: newsItems.signals,
          extra: newsItems.extra,
          sourceId: newsItems.sourceId,
          sourceName: newsSources.name,
          sourceType: newsSources.type,
        })
        .from(newsItems)
        .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
        .where(eq(newsItems.storyId, id))
        .orderBy(newsItems.publishedAt);
      if (members.length === 0) continue;

      const content = await generateStoryContent(
        members.map((m) => ({
          title: m.title,
          excerpt: m.excerpt,
          sourceName: m.sourceName,
        })),
        config,
      );
      await db
        .update(newsStories)
        .set({
          title: content.title,
          summary: content.summary,
          tags: content.tags,
          itemCount: members.length,
          sourceCount: new Set(members.map((m) => m.sourceId)).size,
          signalsSummary: buildSignalsSummary(members),
          dirty: false,
          updatedAt: new Date(),
        })
        .where(eq(newsStories.id, id));
    } catch (error) {
      // 失败保持 dirty=true，下轮重试
      console.error(`[NewsCron][summarize] story ${id} failed:`, error);
    }
  }
  if (dirtyStories.length > 0)
    log("summarize", `processed ${dirtyStories.length} dirty stories`);
}

// ---- Stage 6: refresh HN signals ----

async function refreshStage(db: Db): Promise<void> {
  const items = await db
    .select({
      id: newsItems.id,
      extra: newsItems.extra,
      storyId: newsItems.storyId,
    })
    .from(newsItems)
    .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
    .where(
      and(
        eq(newsSources.type, "hn"),
        gt(newsItems.publishedAt, windowStart()),
        eq(newsItems.status, "clustered"),
      ),
    )
    .limit(MAX_HN_REFRESH_PER_ROUND);

  const touchedStories = new Set<string>();
  for (const item of items) {
    const hnId = typeof item.extra?.hnId === "string" ? item.extra.hnId : null;
    if (!hnId) continue;
    const signals = await fetchHnItemSignals(hnId);
    if (!signals) continue;
    await db
      .update(newsItems)
      .set({ signals })
      .where(eq(newsItems.id, item.id));
    if (item.storyId) touchedStories.add(item.storyId);
  }

  // 只重建 signalsSummary，不触发 LLM 重摘要
  for (const storyId of touchedStories) {
    const members = await db
      .select({
        url: newsItems.url,
        author: newsItems.author,
        signals: newsItems.signals,
        extra: newsItems.extra,
        sourceType: newsSources.type,
      })
      .from(newsItems)
      .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
      .where(eq(newsItems.storyId, storyId));
    await db
      .update(newsStories)
      .set({
        signalsSummary: buildSignalsSummary(members),
        updatedAt: new Date(),
      })
      .where(eq(newsStories.id, storyId));
  }
  if (items.length > 0)
    log(
      "refresh",
      `refreshed ${items.length} HN items, ${touchedStories.size} stories`,
    );
}

// ---- Stage 7: archive + 清理 ----

async function archiveStage(db: Db): Promise<void> {
  await db
    .update(newsStories)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      and(
        eq(newsStories.status, "active"),
        lt(newsStories.lastActivityAt, windowStart()),
      ),
    );

  // 清理孤儿 story（cluster 阶段崩溃可能留下无成员的 story；见 D1 无事务的写入顺序）
  // inArray 限 20 个 id：D1 单查询绑定参数上限 100，永远不要放大超过它
  const orphanCutoff = new Date(Date.now() - 24 * 3600_000);
  const orphans = await db
    .select({ id: newsStories.id })
    .from(newsStories)
    .leftJoin(newsItems, eq(newsItems.storyId, newsStories.id))
    .where(and(isNull(newsItems.id), lt(newsStories.createdAt, orphanCutoff)))
    .limit(20);
  if (orphans.length > 0) {
    await db.delete(newsStories).where(
      inArray(
        newsStories.id,
        orphans.map((o) => o.id),
      ),
    );
    log("archive", `deleted ${orphans.length} orphan stories`);
  }
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const db = drizzle(env.DB);
    // 阶段串行、独立容错：单阶段失败不阻塞后续（所有阶段幂等，下轮 cron 续跑）
    const stages: Array<[string, () => Promise<void>]> = [
      ["fetch", () => fetchStage(db, env)],
      ["filter", () => filterStage(db, env)],
      ["embed", () => embedStage(db, env)],
      ["cluster", () => clusterStage(db, env)],
      ["summarize", () => summarizeStage(db, env)],
      ["refresh", () => refreshStage(db)],
      ["archive", () => archiveStage(db)],
    ];
    for (const [name, run] of stages) {
      try {
        await run();
      } catch (error) {
        console.error(`[NewsCron][${name}] stage failed:`, error);
      }
    }
  },
};
