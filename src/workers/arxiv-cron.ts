import { lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { hfSignals } from "#/db/schema";
import { canonicalArxivUrl, HF_DAILY_PAPERS_API } from "#/lib/arxiv";
import { createGalleryPaper, ensureGuestUser } from "#/lib/gallery-paper";
import type { Env } from "#/types/env";

// 渐切开关：默认 30/3 与旧逻辑逐字节等价；方向简报管线供货稳定后把 secret 改成
// 100/0 即完成 HF 降级（仅爆款兜底入库、不补底），不用重新部署。
const DEFAULT_MIN_UPVOTES = 30;
const DEFAULT_TOP_FALLBACK = 3;

/** 导出仅为测试 */
export function intFromEnv(
  raw: string | undefined,
  name: string,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.warn(
      `[ArxivCron] invalid ${name}="${raw}", using default ${fallback}`,
    );
    return fallback;
  }
  return n;
}

/**
 * 导出仅为测试：把「部署即零变化」这条承诺（默认 30/3）钉成断言。
 * 参数用结构化字面量而非 Env，测试传 `{}` 即可；Env 结构上满足它。
 */
export function resolveSelection(env: {
  HF_MIN_UPVOTES?: string;
  HF_TOP_FALLBACK?: string;
}): { minUpvotes: number; topFallback: number } {
  return {
    minUpvotes: intFromEnv(
      env.HF_MIN_UPVOTES,
      "HF_MIN_UPVOTES",
      DEFAULT_MIN_UPVOTES,
    ),
    topFallback: intFromEnv(
      env.HF_TOP_FALLBACK,
      "HF_TOP_FALLBACK",
      DEFAULT_TOP_FALLBACK,
    ),
  };
}

// 该 interface 只覆盖 cron 阈值判断所需字段(id/title/upvotes)，
// src/lib/agent.ts 的 listDailyPapers 工具还要展示 summary/authors/publishedAt，
// 且对外部 JSON 更防御(字段可选)，形状不同故各自定义；导出仅为 cron 测试。
// HF_DAILY_PAPERS_API 常量见 #/lib/arxiv。
export interface HFPaper {
  paper: {
    id: string; // arxiv id
    title: string;
    upvotes: number;
  };
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const startTime = Date.now();
    console.log(
      "[ArxivCron] Starting at",
      new Date(controller.scheduledTime).toISOString(),
    );

    const db = drizzle(env.DB);

    try {
      // Step 1: upsert guest user，确保存在且 credits 充足
      await ensureGuestUser(db);

      // Step 2: 获取昨天 HF Daily Papers（昨天的投票已完整积累）
      const yesterday = getYesterdayUTC();
      const hfPapers = await fetchDailyPapers(yesterday);
      console.log(`[ArxivCron] Fetching papers for date: ${yesterday}`);
      console.log(`[ArxivCron] Fetched ${hfPapers.length} papers from HF`);

      // Step 2.5: 全量写入 HF 热度信号（供方向周报挖掘加权），90 天滚动清理
      // 信号写入失败不应阻断当天 gallery 论文创建，故单独 catch 且不 rethrow。
      try {
        await recordHfSignals(db, hfPapers, yesterday);
      } catch (error) {
        console.error("[ArxivCron] Failed to record HF signals:", error);
      }

      // Step 3: 筛选：过线论文全取，不足 topFallback 篇时补到 topFallback 篇
      // （阈值与补底篇数均由 env 控制，见 DEFAULT_MIN_UPVOTES / DEFAULT_TOP_FALLBACK）
      const { minUpvotes, topFallback } = resolveSelection(env);
      const selected = selectPapers(hfPapers, minUpvotes, topFallback);
      console.log(
        `[ArxivCron] Selected ${selected.length} papers (min=${minUpvotes}, fallback=${topFallback}):`,
        selected.map((p) => `${p.paper.id}(${p.paper.upvotes})`).join(", "),
      );

      // Step 4: 逐篇处理
      let created = 0;
      let skipped = 0;
      for (const item of selected) {
        // 规范化成 canonical 形式后再存/查重, 与 DB partial unique index 用同一身份键。
        const arxivUrl = canonicalArxivUrl(item.paper.id);

        const { created: wasCreated } = await createGalleryPaper(db, env, {
          arxivUrl,
          title: item.paper.title,
          upvotes: item.paper.upvotes,
          creditDescription: `Arxiv cron: ${item.paper.title}`,
        });

        if (wasCreated) {
          created++;
        } else {
          skipped++;
        }
      }

      const duration = Date.now() - startTime;
      console.log(
        `[ArxivCron] Done in ${duration}ms: ${created} created, ${skipped} skipped (duplicate)`,
      );
    } catch (error) {
      console.error("[ArxivCron] Fatal error:", error);
      throw error;
    }
  },
};

async function fetchDailyPapers(date?: string): Promise<HFPaper[]> {
  const url = date
    ? `${HF_DAILY_PAPERS_API}?date=${date}`
    : HF_DAILY_PAPERS_API;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HF API error: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as HFPaper[];
  return data;
}

function getYesterdayUTC(): string {
  const d = new Date(Date.now() - 86400000);
  return d.toISOString().slice(0, 10);
}

/** 导出仅为测试 */
export function selectPapers(
  papers: HFPaper[],
  minUpvotes: number,
  topFallback: number,
): HFPaper[] {
  // 不原地排序：调用方的 hfPapers 随后还要用于别处
  const sorted = [...papers].sort((a, b) => b.paper.upvotes - a.paper.upvotes);

  // upvotes >= minUpvotes 全取
  const aboveThreshold = sorted.filter((p) => p.paper.upvotes >= minUpvotes);

  // 不足 topFallback 篇时补到 topFallback 篇；
  // topFallback=0 时该分支恒真：只取过线论文、不补底
  if (aboveThreshold.length >= topFallback) return aboveThreshold;

  return sorted.slice(0, topFallback);
}

async function recordHfSignals(
  db: ReturnType<typeof drizzle>,
  hfPapers: HFPaper[],
  date: string,
): Promise<void> {
  const now = new Date();
  // 单条 4 个绑定参数 + ON CONFLICT DO UPDATE 里的 updated_at=? 每条语句只出现
  // 一次，故 N 条/批的参数数是 4N+1。20 条/批 = 81 参数，在 D1 上限 100 内留有
  // 余量（25 条/批则是 101，会超限）。
  const rows = hfPapers.map((p) => ({
    arxivId: p.paper.id,
    upvotes: p.paper.upvotes,
    date,
    updatedAt: now,
  }));
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    await db
      .insert(hfSignals)
      .values(batch)
      .onConflictDoUpdate({
        target: hfSignals.arxivId,
        set: { upvotes: sql`excluded.upvotes`, updatedAt: now },
      });
  }
  const cutoff = new Date(Date.now() - 90 * 86400_000)
    .toISOString()
    .slice(0, 10);
  await db.delete(hfSignals).where(lt(hfSignals.date, cutoff));
  console.log(`[ArxivCron] Recorded ${rows.length} HF signals for ${date}`);
}
