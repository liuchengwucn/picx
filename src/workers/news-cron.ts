import { and, desc, eq, gt, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import { newsItems, newsSources, newsStories } from "#/db/schema";
import type { AIConfig } from "#/lib/ai";
import { fetchHn, fetchHnItemSignals } from "#/lib/news/adapters/hn";
import { fetchFeed } from "#/lib/news/adapters/rss";
import { fetchRsshub } from "#/lib/news/adapters/rsshub";
import {
  type EmbedProvider,
  embedTexts,
  generateStoryContent,
  judgeAssignment,
  scoreRelevance,
} from "#/lib/news/ai";
import { buildSignalsSummary } from "#/lib/news/signals";
import { cleanScrapedResearchTitle } from "#/lib/news/title-clean";
import type { NormalizedItem } from "#/lib/news/types";
import { hashUrl } from "#/lib/news/url";
import { cosineSimilarity, meanVector, mergeCentroid } from "#/lib/news/vector";
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
// Cron 触发的硬上限是 15 分钟；留 4 分钟余量，让平台 kill 永远不会落在写入中途。
// 各阶段在循环边界主动收手，未处理的积压下一轮继续（所有阶段都按状态幂等取活）。
const ROUND_BUDGET_MS = 11 * 60_000;

type Db = DrizzleD1Database;

function log(step: string, message: string) {
  console.log(`[NewsCron][${step}] ${message}`);
}

/** 循环边界的时间预算检查。超时即让出，剩余工作交给下一轮 cron。 */
function pastDeadline(deadline: number, step: string): boolean {
  if (Date.now() <= deadline) return false;
  log(step, "deadline reached, deferring rest to next round");
  return true;
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

function windowStart(env: Env): Date {
  // 运维旋钮：NEWS_INGEST_WINDOW_HOURS 临时放宽摄入/活跃窗口做历史回填
  // （如 336 = 14 天），回填完删除该变量即恢复默认 72h。上限护栏防误配。
  const override = Number(env.NEWS_INGEST_WINDOW_HOURS);
  const hours =
    Number.isFinite(override) && override > 0 && override <= 24 * 90
      ? override
      : CLUSTER_WINDOW_HOURS;
  return new Date(Date.now() - hours * 3600_000);
}

// ---- Stage 1: fetch ----

async function fetchForSource(
  source: typeof newsSources.$inferSelect,
  env: Env,
): Promise<NormalizedItem[]> {
  switch (source.type) {
    case "rss": {
      if (!source.config.url) return [];
      const items = await fetchFeed(source.config.url);
      if (source.config.titleClean !== "scraped-research") return items;
      // 社区抓取镜像的标题带拼接杂质（日期/分类前缀、尾随描述），入库前清洗；
      // 清洗结果为 null 的是导航杂质条目，整条丢弃
      return items.flatMap((item) => {
        const title = cleanScrapedResearchTitle(item.title);
        return title ? [{ ...item, title }] : [];
      });
    }
    case "rsshub":
      if (!env.RSSHUB_BASE_URL) {
        log("fetch", `skip ${source.id}: RSSHUB_BASE_URL not configured`);
        return [];
      }
      return fetchRsshub(
        env.RSSHUB_BASE_URL,
        source.config,
        env.RSSHUB_ACCESS_KEY,
      );
    case "hn":
      // HN 必须用宽回看窗（72h）：新帖需要时间攒分，短窗+分数阈值组合会永远抓不到内容
      // （实测 3h 窗口命中 0 条）。重复条目靠 urlHash onConflict 去重并合并 signals/extra。
      return fetchHn(source.config, windowStart(env));
  }
}

async function fetchStage(db: Db, env: Env, deadline: number): Promise<void> {
  const ingestCutoff = windowStart(env);
  const sources = await db
    .select()
    .from(newsSources)
    .where(eq(newsSources.enabled, true));
  for (const source of sources) {
    if (pastDeadline(deadline, "fetch")) break;
    try {
      const items = await fetchForSource(source, env);
      let inserted = 0;
      let itemErrors = 0;
      for (const item of items) {
        // 冷启动保护：feed 里的历史文章不入库（否则首轮会把多年旧文当新闻），窗口与聚类窗口一致
        if (item.publishedAt < ingestCutoff) continue;
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
        // 写入单条失败（D1 抖动等）只记数，不进 source 失败计数：
        // 否则 10 次瞬时写错就会误禁一个健康来源。
        try {
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
          } else if (item.signals || item.extra) {
            // 同一 canonical URL 被多来源命中（HN 帖 vs 原文 RSS，或另一账号转发）。
            // 必须合并而不是丢弃：先入者若是 RSS，HN 的 hnId/hnUrl 会被吃掉，
            // 于是 points 既不展示也永远不会被 refresh 阶段回刷。
            // json_patch 在 SQLite 侧做 RFC 7386 合并，保住已有键（如 isTweet），
            // 同名键以新值为准，且不需要先读回旧 extra。
            // Pick 自 drizzle 的 set-source 类型：键名/值类型都对着表结构校验，
            // 字段改名或键打错会直接编译失败，而不是悄悄写进不存在的列。
            const patch: Pick<
              SQLiteUpdateSetSource<typeof newsItems>,
              "signals" | "extra"
            > = {};
            if (item.signals) patch.signals = item.signals;
            if (item.extra) {
              patch.extra = sql`json_patch(coalesce(${newsItems.extra}, '{}'), ${JSON.stringify(item.extra)})`;
            }
            await db
              .update(newsItems)
              .set(patch)
              .where(eq(newsItems.urlHash, urlHash));
          }
        } catch (error) {
          itemErrors++;
          console.error(
            `[NewsCron][fetch] ${source.id}: item write failed (${item.url.slice(0, 120)}):`,
            error,
          );
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
      log(
        "fetch",
        `${source.id}: ${items.length} fetched, ${inserted} new${itemErrors > 0 ? `, ${itemErrors} write errors` : ""}`,
      );
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

async function filterStage(db: Db, env: Env, deadline: number): Promise<void> {
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

  const config = aiConfigFromEnv(env);
  let scored = 0;
  for (let i = 0; i < pending.length; i += FILTER_BATCH_SIZE) {
    if (pastDeadline(deadline, "filter")) break;
    const batch = pending.slice(i, i + FILTER_BATCH_SIZE);
    // 单批失败（模型返回长度不符/限流）不牵连其他批；未打分的条目下轮重取
    try {
      const scores = await scoreRelevance(batch, config);
      // 逐条 UPDATE：相对 LLM 调用耗时可忽略。真正的约束是 cron 15 分钟 wall-clock，
      // 已由 deadline 守卫在批边界兜住。
      for (let j = 0; j < batch.length; j++) {
        await db
          .update(newsItems)
          .set({
            relevanceScore: scores[j],
            status: scores[j] < RELEVANCE_THRESHOLD ? "rejected" : "pending",
          })
          .where(eq(newsItems.id, batch[j].id));
      }
      scored += batch.length;
    } catch (error) {
      console.error(`[NewsCron][filter] batch at offset ${i} failed:`, error);
    }
  }
  log("filter", `scored ${scored}/${pending.length} items`);
}

// ---- Stage 3: embed ----

// 配置了 REST 凭据时 embed 走 Workers AI REST API（本地 dev 关闭 remote bindings
// 后 AI binding 不可用的回退路径）；未配置时走 binding（生产默认）
function embedProvider(env: Env): EmbedProvider {
  if (env.WORKERS_AI_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) {
    return {
      kind: "rest",
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.WORKERS_AI_API_TOKEN,
    };
  }
  return { kind: "binding", ai: env.AI };
}

async function embedStage(db: Db, env: Env, deadline: number): Promise<void> {
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
        gte(newsItems.relevanceScore, RELEVANCE_THRESHOLD),
        isNull(newsItems.embedding),
      ),
    )
    .limit(MAX_EMBED_PER_ROUND);
  if (items.length === 0) return;

  const CHUNK = 20;
  let embedded = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    if (pastDeadline(deadline, "embed")) break;
    const chunk = items.slice(i, i + CHUNK);
    // 单块失败（Workers AI 超时/限流）不牵连其他块；embedding 仍为 null，下轮重取
    try {
      const vectors = await embedTexts(
        embedProvider(env),
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
      embedded += chunk.length;
    } catch (error) {
      console.error(`[NewsCron][embed] chunk at offset ${i} failed:`, error);
    }
  }
  log("embed", `embedded ${embedded}/${items.length} items`);
}

// ---- Stage 4: cluster ----

async function clusterStage(db: Db, env: Env, deadline: number): Promise<void> {
  // 显式投影：media/extra 可达数 KB，聚类用不到，别白拉过来
  const items = await db
    .select({
      id: newsItems.id,
      title: newsItems.title,
      excerpt: newsItems.excerpt,
      embedding: newsItems.embedding,
      publishedAt: newsItems.publishedAt,
    })
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
      earliestPublishedAt: newsStories.earliestPublishedAt,
    })
    .from(newsStories)
    .where(
      and(
        eq(newsStories.status, "active"),
        gt(newsStories.lastActivityAt, windowStart(env)),
      ),
    );

  const config = aiConfigFromEnv(env);
  let merged = 0;
  let created = 0;
  let failed = 0;

  for (const item of items) {
    if (pastDeadline(deadline, "cluster")) break;
    // 单条失败不牵连其余：item 仍是 pending，下轮重判（写入顺序保证幂等）
    try {
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
        // D1 无事务：先更新 story 再更新 item；若中间崩溃，item 仍是 pending，
        // 下轮会再并入一次 → itemCount/centroid 偏高。summarize 阶段从成员全量
        // 重算两者来自愈，所以这里的增量偏差是可收敛的。
        const newCentroid = mergeCentroid(
          target.centroid,
          target.itemCount,
          embedding,
        );
        const newEarliestPublishedAt =
          target.earliestPublishedAt === null ||
          item.publishedAt < target.earliestPublishedAt
            ? item.publishedAt
            : target.earliestPublishedAt;
        await db
          .update(newsStories)
          .set({
            centroid: newCentroid,
            itemCount: target.itemCount + 1,
            earliestPublishedAt: newEarliestPublishedAt,
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
        target.earliestPublishedAt = newEarliestPublishedAt;
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
            earliestPublishedAt: item.publishedAt,
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
          earliestPublishedAt: item.publishedAt,
        });
        created++;
      }
    } catch (error) {
      failed++;
      console.error(`[NewsCron][cluster] item ${item.id} failed:`, error);
    }
  }
  log(
    "cluster",
    `${items.length} items → ${merged} merged, ${created} new stories${failed > 0 ? `, ${failed} failed` : ""}`,
  );
}

// ---- Stage 5: summarize ----

async function summarizeStage(
  db: Db,
  env: Env,
  deadline: number,
): Promise<void> {
  const dirtyStories = await db
    .select({ id: newsStories.id })
    .from(newsStories)
    // dirty 的 partial index 只认字面量谓词，不能用 eq()（绑定参数会退化为全表扫描）
    .where(and(sql`${newsStories.dirty} = 1`, eq(newsStories.status, "active")))
    // 活跃度倒序：反复失败的 poison story 无法永久占满这 MAX_SUMMARIZE_PER_ROUND 个名额，
    // 新鲜 story 始终优先。poison story 的放弃路径是 72h 后被 archiveStage 置为
    // archived —— status 不再是 active，自然退出本查询的轮换。
    .orderBy(desc(newsStories.lastActivityAt))
    .limit(MAX_SUMMARIZE_PER_ROUND);
  const config = aiConfigFromEnv(env);
  let done = 0;

  for (const { id } of dirtyStories) {
    if (pastDeadline(deadline, "summarize")) break;
    try {
      const members = await db
        .select({
          title: newsItems.title,
          excerpt: newsItems.excerpt,
          url: newsItems.url,
          author: newsItems.author,
          signals: newsItems.signals,
          extra: newsItems.extra,
          embedding: newsItems.embedding,
          sourceId: newsItems.sourceId,
          sourceName: newsSources.name,
          publishedAt: newsItems.publishedAt,
        })
        .from(newsItems)
        .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
        .where(eq(newsItems.storyId, id))
        .orderBy(newsItems.publishedAt);
      if (members.length === 0) {
        // 无成员：cluster 阶段崩溃留下的孤儿。清掉 dirty 让它退出轮换，
        // 实体本身由 archiveStage 的孤儿清理负责删除。
        await db
          .update(newsStories)
          .set({ dirty: false })
          .where(eq(newsStories.id, id));
        continue;
      }

      const content = await generateStoryContent(
        members.map((m) => ({
          title: m.title,
          excerpt: m.excerpt,
          sourceName: m.sourceName,
        })),
        config,
      );
      // itemCount/sourceCount/centroid/earliestPublishedAt 一律从成员全量重算，自愈 cluster 阶段
      // 可能的重复并入（D1 无事务 → story 已更新但 item 更新失败）。
      // centroid 尤其重要：mergeCentroid 是增量的，偏差不会自己消失。
      // members 已按 publishedAt asc 排序，[0] 即最早发布时间。
      const memberEmbeddings = members
        .map((m) => m.embedding)
        .filter((e): e is Float32Array => e !== null);
      await db
        .update(newsStories)
        .set({
          title: content.title,
          summary: content.summary,
          tags: content.tags,
          itemCount: members.length,
          sourceCount: new Set(members.map((m) => m.sourceId)).size,
          earliestPublishedAt: members[0].publishedAt,
          ...(memberEmbeddings.length > 0
            ? { centroid: meanVector(memberEmbeddings) }
            : {}),
          signalsSummary: buildSignalsSummary(members),
          dirty: false,
          updatedAt: new Date(),
        })
        .where(eq(newsStories.id, id));
      done++;
    } catch (error) {
      // 失败保持 dirty=true，下轮重试
      console.error(`[NewsCron][summarize] story ${id} failed:`, error);
    }
  }
  if (dirtyStories.length > 0)
    log("summarize", `processed ${done}/${dirtyStories.length} dirty stories`);
}

// ---- Stage 6: refresh HN signals ----

async function refreshStage(db: Db, env: Env, deadline: number): Promise<void> {
  // 按 extra.hnId 取活，而不是 join sourceType='hn'：HN 帖与原文 RSS 共享 canonical URL 时，
  // 去重后行可能挂在 rss 来源上，但 extra 里带着 hnId —— 那才是可回刷的判据。
  const items = await db
    .select({
      id: newsItems.id,
      extra: newsItems.extra,
      storyId: newsItems.storyId,
    })
    .from(newsItems)
    .where(
      and(
        sql`json_extract(${newsItems.extra}, '$.hnId') is not null`,
        gt(newsItems.publishedAt, windowStart(env)),
        eq(newsItems.status, "clustered"),
      ),
    )
    // 新帖优先：分数变化几乎都发生在前几小时，且避免超过 limit 时总是回刷同一批
    .orderBy(desc(newsItems.publishedAt))
    .limit(MAX_HN_REFRESH_PER_ROUND);

  const touchedStories = new Set<string>();
  let refreshed = 0;
  for (const item of items) {
    if (pastDeadline(deadline, "refresh")) break;
    const hnId = typeof item.extra?.hnId === "string" ? item.extra.hnId : null;
    if (!hnId) continue;
    try {
      const signals = await fetchHnItemSignals(hnId);
      if (!signals) continue;
      await db
        .update(newsItems)
        .set({ signals })
        .where(eq(newsItems.id, item.id));
      if (item.storyId) touchedStories.add(item.storyId);
      refreshed++;
    } catch (error) {
      console.error(`[NewsCron][refresh] hn item ${hnId} failed:`, error);
    }
  }

  // 只重建 signalsSummary，不触发 LLM 重摘要（hn/xAccounts 均从 extra 判定，无需 join 来源表）
  for (const storyId of touchedStories) {
    const members = await db
      .select({
        url: newsItems.url,
        author: newsItems.author,
        signals: newsItems.signals,
        extra: newsItems.extra,
      })
      .from(newsItems)
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
      `refreshed ${refreshed}/${items.length} HN items, ${touchedStories.size} stories`,
    );
}

// ---- Stage 7: archive + 清理 ----

async function archiveStage(db: Db, env: Env): Promise<void> {
  await db
    .update(newsStories)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      and(
        eq(newsStories.status, "active"),
        lt(newsStories.lastActivityAt, windowStart(env)),
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
    const deadline = Date.now() + ROUND_BUDGET_MS;
    // 阶段串行、独立容错：单阶段失败不阻塞后续（所有阶段幂等，下轮 cron 续跑）
    const stages: Array<[string, () => Promise<void>]> = [
      ["fetch", () => fetchStage(db, env, deadline)],
      ["filter", () => filterStage(db, env, deadline)],
      ["embed", () => embedStage(db, env, deadline)],
      ["cluster", () => clusterStage(db, env, deadline)],
      ["summarize", () => summarizeStage(db, env, deadline)],
      ["refresh", () => refreshStage(db, env, deadline)],
      ["archive", () => archiveStage(db, env)],
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
