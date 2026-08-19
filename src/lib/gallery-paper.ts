import { and, eq, isNull, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { creditTransactions, papers, user } from "#/db/schema";
import { cleanExtractedTitle } from "#/lib/paper-title";
import { generateShortId } from "#/lib/short-id";
import type { Env } from "#/types/env";

export const GUEST_USER_ID = "review-guest-user";
const GUEST_USER_NAME = "Guest";
const GUEST_USER_EMAIL = "review-guest@picx.local";
const GUEST_CREDITS = 99999;

export interface CreateGalleryPaperInput {
  arxivUrl: string; // 必须已 canonicalArxivUrl 规范化
  title: string;
  upvotes: number | null; // 方向论文无 HF 热度时传 null
  directionId?: string;
  creditDescription: string; // 如 "Arxiv cron: {title}" / "Digest {slug}#3: {title}"
}

export async function ensureGuestUser(
  db: ReturnType<typeof drizzle>,
): Promise<void> {
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
    console.log("[GalleryPaper] Guest user created");
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
    console.log(`[GalleryPaper] Guest user topped up: +${toAdd} credits`);
  }
}

export async function createGalleryPaper(
  db: ReturnType<typeof drizzle>,
  env: Env,
  input: CreateGalleryPaperInput,
): Promise<{ created: boolean; paperId: string | null }> {
  const { arxivUrl, title, upvotes } = input;

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
      `[GalleryPaper] Skipping duplicate (already in gallery): ${arxivUrl}`,
    );
    return { created: false, paperId: existing.id };
  }

  const paperId = crypto.randomUUID();
  const now = new Date();

  // 先创建 paper 记录（credit_transactions 有 FK 引用 papers.id）
  await db.insert(papers).values({
    id: paperId,
    shortId: generateShortId(),
    userId: GUEST_USER_ID,
    // 入库即清洗：HF / arXiv 的标题偶尔带 HTML 实体与 LaTeX 转义，
    // 且这条标题此后就是权威值（queue consumer 不再覆盖 arxiv 来源的标题）
    title: cleanExtractedTitle(title),
    sourceType: "arxiv",
    sourceUrl: arxivUrl,
    pdfR2Key: `papers/${GUEST_USER_ID}/placeholder-${paperId}.pdf`, // queue consumer 会更新
    fileSize: 0,
    upvotes,
    directionId: input.directionId ?? null,
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
    description: input.creditDescription,
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

  console.log(`[GalleryPaper] Created paper ${paperId}: ${title}`);
  return { created: true, paperId };
}
