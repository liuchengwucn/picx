import { lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { hfSignals } from "#/db/schema";
import { canonicalArxivUrl, HF_DAILY_PAPERS_API } from "#/lib/arxiv";
import { createGalleryPaper, ensureGuestUser } from "#/lib/gallery-paper";
import type { Env } from "#/types/env";

// HFPaper 不导出：该 interface 只覆盖 cron 阈值判断所需字段(id/title/upvotes)，
// src/lib/agent.ts 的 listDailyPapers 工具还要展示 summary/authors/publishedAt，
// 且对外部 JSON 更防御(字段可选)，形状不同故各自定义；HF_DAILY_PAPERS_API 常量见 #/lib/arxiv。
const MIN_UPVOTES = 30;
const MIN_PAPERS = 3;

interface HFPaper {
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
      await recordHfSignals(db, hfPapers, yesterday);

      // Step 3: 筛选：upvotes >= 30 全取，不足 3 篇补到 3 篇
      const selected = selectPapers(hfPapers);
      console.log(
        `[ArxivCron] Selected ${selected.length} papers:`,
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

function selectPapers(papers: HFPaper[]): HFPaper[] {
  const sorted = [...papers].sort((a, b) => b.paper.upvotes - a.paper.upvotes);

  // upvotes >= MIN_UPVOTES 全取
  const aboveThreshold = sorted.filter((p) => p.paper.upvotes >= MIN_UPVOTES);

  // 不足 MIN_PAPERS 篇时补到 MIN_PAPERS 篇
  if (aboveThreshold.length >= MIN_PAPERS) {
    return aboveThreshold;
  }

  return sorted.slice(0, MIN_PAPERS);
}

async function recordHfSignals(
  db: ReturnType<typeof drizzle>,
  hfPapers: HFPaper[],
  date: string,
): Promise<void> {
  const now = new Date();
  // 单条 4 个绑定参数，25 条/批 = 100 参数封顶线以内（D1 上限 100）
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
