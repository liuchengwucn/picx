import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { creditTransactions, papers, user } from "#/db/schema";
import { canonicalArxivUrl, HF_DAILY_PAPERS_API } from "#/lib/arxiv";
import { generateShortId } from "#/lib/short-id";
import type { Env } from "#/types/env";

const GUEST_USER_ID = "review-guest-user";
const GUEST_USER_NAME = "Guest";
const GUEST_USER_EMAIL = "review-guest@picx.local";
const GUEST_CREDITS = 99999;

// HFPaper 不导出：该 interface 只覆盖 cron 阈值判断所需字段(id/title/upvotes)，
// src/lib/discovery-tools.ts 的 listDailyPapers 工具还要展示 summary/authors/publishedAt，
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
      await upsertGuestUser(db);

      // Step 2: 获取昨天 HF Daily Papers（昨天的投票已完整积累）
      const yesterday = getYesterdayUTC();
      const hfPapers = await fetchDailyPapers(yesterday);
      console.log(`[ArxivCron] Fetching papers for date: ${yesterday}`);
      console.log(`[ArxivCron] Fetched ${hfPapers.length} papers from HF`);

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

        const wasCreated = await createPaperIfNotExists(
          db,
          env,
          arxivUrl,
          item.paper.title,
          item.paper.upvotes,
        );

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

async function upsertGuestUser(db: ReturnType<typeof drizzle>): Promise<void> {
  const now = new Date();

  const [existing] = await db
    .select({ id: user.id, credits: user.credits })
    .from(user)
    .where(eq(user.id, GUEST_USER_ID))
    .limit(1);

  if (!existing) {
    await db.insert(user).values({
      id: GUEST_USER_ID,
      name: GUEST_USER_NAME,
      email: GUEST_USER_EMAIL,
      emailVerified: 1,
      image: null,
      credits: GUEST_CREDITS,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(creditTransactions).values({
      userId: GUEST_USER_ID,
      amount: GUEST_CREDITS,
      type: "purchase",
      description: "Arxiv cron guest initial credits",
    });
    console.log("[ArxivCron] Guest user created");
    return;
  }

  if (existing.credits < GUEST_CREDITS) {
    const toAdd = GUEST_CREDITS - existing.credits;
    await db
      .update(user)
      .set({ credits: GUEST_CREDITS, updatedAt: now })
      .where(eq(user.id, GUEST_USER_ID));
    await db.insert(creditTransactions).values({
      userId: GUEST_USER_ID,
      amount: toAdd,
      type: "purchase",
      description: "Arxiv cron guest credits top-up",
    });
    console.log(`[ArxivCron] Guest user topped up: +${toAdd} credits`);
  }
}

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

async function createPaperIfNotExists(
  db: ReturnType<typeof drizzle>,
  env: Env,
  arxivUrl: string,
  title: string,
  upvotes: number,
): Promise<boolean> {
  // 去重：只检查 gallery 集合(isListedInGallery=1 且未删除)。
  // 私有上传的同一篇 arxiv 不应阻止 gallery 收录, 故不查私有论文。
  const [existing] = await db
    .select({ id: papers.id })
    .from(papers)
    .where(
      and(
        eq(papers.sourceUrl, arxivUrl),
        eq(papers.isListedInGallery, true),
        isNull(papers.deletedAt),
      ),
    )
    .limit(1);

  if (existing) {
    console.log(
      `[ArxivCron] Skipping duplicate (already in gallery): ${arxivUrl}`,
    );
    return false;
  }

  const paperId = crypto.randomUUID();
  const now = new Date();

  // 先创建 paper 记录（credit_transactions 有 FK 引用 papers.id）
  await db.insert(papers).values({
    id: paperId,
    shortId: generateShortId(),
    userId: GUEST_USER_ID,
    title,
    sourceType: "arxiv",
    sourceUrl: arxivUrl,
    pdfR2Key: `papers/${GUEST_USER_ID}/placeholder-${paperId}.pdf`, // queue consumer 会更新
    fileSize: 0,
    upvotes,
    status: "pending",
    isPublic: true,
    isListedInGallery: true,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  // paper 创建后再扣 credit 和记录 transaction（FK 约束要求 paper 先存在）
  await db
    .update(user)
    .set({ credits: sql`${user.credits} - 1`, updatedAt: now })
    .where(eq(user.id, GUEST_USER_ID));

  await db.insert(creditTransactions).values({
    userId: GUEST_USER_ID,
    amount: -1,
    type: "consume",
    relatedPaperId: paperId,
    description: `Arxiv cron: ${title}`,
  });

  // 推入处理队列
  await env.PAPER_QUEUE.send({
    paperId,
    userId: GUEST_USER_ID,
    type: "initial",
    sourceType: "arxiv",
    arxivUrl: arxivUrl,
    extraLanguages: ["zh-cn", "zh-tw", "ja"],
    generateWhiteboard: true,
  });

  console.log(`[ArxivCron] Created paper ${paperId}: ${title}`);
  return true;
}
