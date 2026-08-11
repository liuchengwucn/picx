import { TRPCError } from "@trpc/server";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  creditTransactions,
  paperContents,
  paperResults,
  papers,
  user,
  userApiConfigs,
  whiteboardImages,
  whiteboardPrompts,
} from "#/db/schema";
import type { AIConfig } from "#/lib/ai";
import { translateSummary } from "#/lib/ai";
import { canonicalArxivUrl } from "#/lib/arxiv";
import { escapeLike, parseSort } from "#/lib/gallery-search";
import { submitIndexNow } from "#/lib/indexnow";
import { normalizeCategorySlugs } from "#/lib/paper-categories";
import {
  IN_FLIGHT_PAPER_STATUSES,
  isInFlightPaperStatus,
} from "#/lib/paper-status";
import { selectRelatedPapers } from "#/lib/related-papers";
import {
  getReviewGuestServerSession,
  isReviewGuestModeEnabled,
  isReviewGuestReadOnlySession,
} from "#/lib/review-guest";
import { generateShortId } from "#/lib/short-id";
import { SITE_URL } from "#/lib/site-url";
import { normalizeLocaleKey } from "#/lib/tldr";
import { UPLOAD_ERROR } from "#/lib/upload-errors";
import { protectedProcedure, publicProcedure, router } from "../init";

/**
 * 论文公开上架后, 通知 IndexNow 抓取其页面与 Markdown 视图 (fire-and-forget)。
 * 仅当论文真正对外可见 (isPublic && isListedInGallery) 时才 ping。
 */
function pingIndexNow(
  env: { INDEXNOW_KEY?: string },
  shortId: string | null,
): void {
  if (!shortId) return;
  void submitIndexNow({
    siteUrl: SITE_URL,
    key: env.INDEXNOW_KEY,
    urls: [`${SITE_URL}/p/${shortId}`, `${SITE_URL}/p/${shortId}.md`],
  });
}

/**
 * 从结构化 Markdown 摘要中抽取一段简短片段, 作为 tldr 的兜底
 * (存量数据没有 tldr 时使用)。
 *
 * 摘要开头固定是 "## Summary (Overview)" 段 + 几条要点。
 * 这里剥掉 Markdown / LaTeX, 跳过标题行, 取最前面的正文/要点,
 * 不依赖具体标题文字, 因此对多语言都适用。
 */
function extractSummarySnippet(markdown: string, maxLen = 200): string {
  if (!markdown) return "";

  const text = markdown
    // 去掉代码块
    .replace(/```[\s\S]*?```/g, " ")
    // 去掉行内代码反引号
    .replace(/`([^`]*)`/g, "$1")
    // 去掉 LaTeX 块级与行内公式
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$[^$\n]*\$/g, " ");

  const lines = text.split("\n");
  // 结构化摘要必有 "## ..." 标题。若存在标题, 只从第一个标题之后开始抓正文,
  // 以跳过模型偶尔生成的开场白 (如 "好的，我将为您总结..." / "Here is the summary...")。
  const hasHeading = lines.some((l) => /^\s*#{1,6}\s/.test(l));
  let seenHeading = !hasHeading;

  const parts: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // 跳过标题、表格、引用、分隔线
    if (/^#{1,6}\s/.test(line)) {
      seenHeading = true;
      continue;
    }
    if (!seenHeading) continue;
    if (line.startsWith("|") || /^[-:\s|]+$/.test(line)) continue;
    if (line.startsWith(">")) continue;
    if (/^([-*_])\1{2,}$/.test(line)) continue;

    // 去掉列表 / 编号标记
    const cleaned = line
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      // 链接 [text](url) -> text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // 加粗 / 斜体标记
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .trim();

    if (!cleaned) continue;
    parts.push(cleaned);

    const joined = parts.join(" · ");
    if (joined.length >= maxLen) {
      return `${joined.slice(0, maxLen).trimEnd()}…`;
    }
  }

  return parts.join(" · ");
}

/**
 * 取某条 paper_result 在指定语言下的 tldr:
 * 优先用已生成的多语言 tldr, 缺失则回退到英文 tldr,
 * 再缺失则从对应语言 (或英文) 的 summary 里抽片段兜底。
 */
function resolveTldr(
  tldr: Record<string, string> | null,
  summaries: Record<string, string> | null,
  localeKey: "en" | "zh-cn" | "zh-tw" | "ja",
): string {
  if (tldr) {
    if (tldr[localeKey]) return tldr[localeKey];
    if (tldr.en) return tldr.en;
  }
  if (summaries) {
    const source = summaries[localeKey] ?? summaries.en;
    if (source) return extractSummarySnippet(source);
  }
  return "";
}

function assertGuestWriteAllowed(session: { user: { id: string } }) {
  if (isReviewGuestReadOnlySession(session)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Review guest mode is read-only",
    });
  }
}

export const paperRouter = router({
  /**
   * Create a new paper processing task
   * Deducts 1 credit from user and creates paper record
   */
  create: protectedProcedure
    .input(
      z.object({
        sourceType: z.enum(["upload", "arxiv"]),
        arxivUrl: z.string().url().optional(),
        filename: z.string().min(1).max(255),
        fileSize: z
          .number()
          .int()
          .min(0) // Allow 0 for arxiv (will be updated after download)
          .max(100 * 1024 * 1024), // 100MB
        r2Key: z.string().min(1),
        language: z.enum(["en", "zh-CN", "zh-TW", "ja"]).optional(), // 摘要语言
        whiteboardLanguage: z.enum(["en", "zh-cn", "zh-tw", "ja"]).optional(), // 白板图语言
        apiConfigId: z.string().uuid().optional(), // 用户提供的 API 配置
        promptId: z.string().uuid().optional(), // 用户提供的 Prompt 模板
        generateWhiteboard: z.boolean().optional().default(false), // 是否生成白板图（收费项）
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);
      let paper: typeof papers.$inferSelect;

      /**
       * arXiv 分支一律按 canonical 形式（https://arxiv.org/abs/{id}）落库。
       * http/https、abs/pdf、版本号 vN 的差异会把同一篇论文写成两条不同的
       * source_url（见 lib/arxiv.ts 顶部约定），既让下面的去重失效，也让助手
       * 卡片的 inLibrary 判定出现假阴性。
       */
      const arxivUrl =
        input.sourceType === "arxiv" && input.arxivUrl
          ? canonicalArxivUrl(input.arxivUrl)
          : input.arxivUrl;

      // D1 不支持事务，所以直接执行操作
      // 注意：这不是原子的，但 D1 的限制
      try {
        // Better Auth 已经管理用户，直接使用 session 中的 user ID
        const userId = ctx.session.user.id;

        // 防止登录用户传他人前缀的 r2Key，白嫖解析别人已上传的私有 PDF。
        if (
          input.sourceType === "upload" &&
          !input.r2Key.startsWith(`papers/${userId}/`)
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            // message 是稳定 CODE，客户端按码映射本地化文案（lib/upload-errors.ts）
            message: UPLOAD_ERROR.INVALID_R2_KEY,
          });
        }

        // 同一用户重复入库同一篇 arXiv（刷新页面、翻历史消息后又点了一次「加入」）
        // 直接返回已有那条：不扣积分、不建新行、不投队列。
        // failed 不拦：重新提交同一 URL 是失败论文唯一的重试通路。
        // D1 无事务，「先查后扣」之间仍有并发窗口——客户端已按论文挡住同一处的
        // 连点，跨端同时点同一篇的概率极小，接受双建。
        if (input.sourceType === "arxiv" && arxivUrl) {
          const [existing] = await ctx.db
            .select({
              id: papers.id,
              status: papers.status,
              shortId: papers.shortId,
            })
            .from(papers)
            .where(
              and(
                eq(papers.userId, userId),
                eq(papers.sourceUrl, arxivUrl),
                isNull(papers.deletedAt),
                // 有非 failed 副本就命中它；全都 failed 才落到重试路径
                ne(papers.status, "failed"),
              ),
            )
            .limit(1);

          if (existing) {
            return {
              paperId: existing.id,
              status: existing.status,
              shortId: existing.shortId,
              alreadyExists: true,
            };
          }
        }

        if (input.apiConfigId) {
          const [apiConfig] = await ctx.db
            .select({ id: userApiConfigs.id })
            .from(userApiConfigs)
            .where(
              and(
                eq(userApiConfigs.id, input.apiConfigId),
                eq(userApiConfigs.userId, userId),
              ),
            )
            .limit(1);

          if (!apiConfig) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: UPLOAD_ERROR.API_CONFIG_NOT_FOUND,
            });
          }
        }

        if (input.promptId) {
          const [prompt] = await ctx.db
            .select({ id: whiteboardPrompts.id })
            .from(whiteboardPrompts)
            .where(
              and(
                eq(whiteboardPrompts.id, input.promptId),
                eq(whiteboardPrompts.userId, userId),
              ),
            )
            .limit(1);

          if (!prompt) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: UPLOAD_ERROR.PROMPT_NOT_FOUND,
            });
          }
        }

        // 解析 + 总结免费；仅生成 whiteboard 且未用 BYOK 时扣 1 credit
        const charged = input.generateWhiteboard && !input.apiConfigId;
        if (charged) {
          // 先扣除积分，使用条件更新确保积分足够
          const [updatedUser] = await ctx.db
            .update(user)
            .set({
              credits: sql`${user.credits} - 1`,
            })
            .where(and(eq(user.id, userId), sql`${user.credits} >= 1`))
            .returning();

          // 如果没有更新任何行，说明积分不足
          if (!updatedUser) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: UPLOAD_ERROR.INSUFFICIENT_CREDITS,
            });
          }
        }

        // 创建论文记录
        const [newPaper] = await ctx.db
          .insert(papers)
          .values({
            userId: userId,
            title: input.filename,
            sourceType: input.sourceType,
            sourceUrl: arxivUrl,
            pdfR2Key: input.r2Key,
            fileSize: input.fileSize,
            status: "pending",
            shortId: generateShortId(),
          })
          .returning();

        // 只有在扣除了 credit 的情况下才记录积分交易
        if (charged) {
          await ctx.db.insert(creditTransactions).values({
            userId: userId,
            amount: -1,
            type: "consume",
            relatedPaperId: newPaper.id,
            description: "Whiteboard generation",
          });
        }

        paper = newPaper;
      } catch (error) {
        // 如果是我们抛出的 TRPCError，直接重新抛出
        if (error instanceof TRPCError) {
          throw error;
        }
        // 其他错误包装为 INTERNAL_SERVER_ERROR
        console.error("Failed to create paper:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create paper",
          cause: error,
        });
      }

      // 推送到队列进行异步处理
      try {
        // 将 Paraglide 的语言代码映射为 AI 函数使用的语言代码
        const queueLanguage: "en" | "zh-cn" | "zh-tw" | "ja" | undefined =
          input.language
            ? input.language === "zh-CN"
              ? "zh-cn"
              : input.language === "zh-TW"
                ? "zh-tw"
                : input.language
            : undefined;

        const queueWhiteboardLanguage: "en" | "zh-cn" | "zh-tw" | "ja" =
          input.whiteboardLanguage || "en";

        await ctx.env.PAPER_QUEUE.send({
          paperId: paper.id,
          userId: ctx.session.user.id,
          sourceType: input.sourceType,
          // 与落库的 source_url 同一个值；consumer 认 abs 形式（arxiv-cron 一直这么投）
          arxivUrl,
          r2Key: input.r2Key,
          language: queueLanguage,
          whiteboardLanguage: queueWhiteboardLanguage,
          apiConfigId: input.apiConfigId,
          promptId: input.promptId,
          generateWhiteboard: input.generateWhiteboard,
        });
      } catch (error) {
        await ctx.db
          .update(papers)
          .set({
            status: "failed",
            errorMessage: "Queue dispatch failed",
          })
          .where(eq(papers.id, paper.id));

        // 入队失败时，若这条消息本应扣费，需退款（不要引用 try 内的局部变量，直接重算条件）
        if (input.generateWhiteboard && !input.apiConfigId) {
          await ctx.db
            .update(user)
            .set({
              credits: sql`${user.credits} + 1`,
            })
            .where(eq(user.id, ctx.session.user.id));

          await ctx.db.insert(creditTransactions).values({
            userId: ctx.session.user.id,
            amount: 1,
            type: "refund",
            relatedPaperId: paper.id,
            description: "Refund for failed queue dispatch",
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Paper created but queue dispatch failed",
          cause: error,
        });
      }

      return {
        paperId: paper.id,
        status: paper.status,
        shortId: paper.shortId,
        alreadyExists: false,
      };
    }),

  /**
   * List user's papers with pagination
   */
  list: protectedProcedure
    .input(
      z.object({
        // 游标即 offset。之所以叫 cursor 而不是 page，是为了让前端能用
        // trpc.paper.list.infiniteQueryOptions —— 那样 queryKey 仍在 paper.list
        // 路径下，use-paper-sse / share-banner / 删除论文那三处按 tRPC key 做的
        // invalidate 才不会失配。换成自定义 queryKey 会让列表在处理完成后不刷新。
        cursor: z.number().int().min(0).nullish(),
        limit: z.number().int().min(1).max(100).default(50),
        // "processing" 是列表页「处理中」筛选的聚合值，展开成所有在途状态；
        // 其余是具体状态，逐个精确匹配。
        status: z
          .enum([
            "pending",
            "parsing",
            "processing_text",
            "processing_image",
            "processing",
            "completed",
            "failed",
          ])
          .optional(),
        search: z.string().trim().max(100).optional(),
        locale: z.enum(["en", "zh-CN", "zh-TW", "ja"]).optional(),
        // 上限 20：categories/tags 各自展开成一个 LIKE 条件，D1 单查询绑定参数
        // 上限是 100，留足余量。
        categories: z.array(z.string()).max(20).optional(),
        tags: z.array(z.string().max(50)).max(20).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const offset = input.cursor ?? 0;
      const localeKey = normalizeLocaleKey(input.locale);

      const conditions = [
        eq(papers.userId, ctx.session.user.id),
        isNull(papers.deletedAt),
      ];

      if (input.status === "processing") {
        conditions.push(inArray(papers.status, IN_FLIGHT_PAPER_STATUSES));
      } else if (input.status) {
        conditions.push(eq(papers.status, input.status));
      }

      // 搜索: 标题 + 当前语言 tldr/summary + tags(LIKE, CJK 子串友好)。
      // 写法与 listPublic 一致。
      // json_extract(...) LIKE 无法走索引,会对用户库全表扫描,且下面的 count
      // 查询会重复同样的扫描。库大了要换成 denormalized search_text 列或 FTS5。
      if (input.search) {
        const needle = `%${escapeLike(input.search)}%`;
        const localePath = `$."${localeKey}"`;
        const searchCond = or(
          sql`${papers.title} LIKE ${needle} ESCAPE '\\'`,
          sql`json_extract(${paperResults.tldr}, ${localePath}) LIKE ${needle} ESCAPE '\\'`,
          sql`json_extract(${paperResults.summaries}, ${localePath}) LIKE ${needle} ESCAPE '\\'`,
          sql`${paperResults.tags} LIKE ${needle} ESCAPE '\\'`,
        );
        if (searchCond) conditions.push(searchCond);
      }

      const cats = normalizeCategorySlugs(input.categories ?? []);
      if (cats.length > 0) {
        const catCond = or(
          ...cats.map(
            (slug) => sql`${paperResults.categories} LIKE ${`%"${slug}"%`}`,
          ),
        );
        if (catCond) conditions.push(catCond);
      }

      const tagList = (input.tags ?? [])
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (tagList.length > 0) {
        const tagCond = or(
          ...tagList.map(
            (t) =>
              sql`${paperResults.tags} LIKE ${`%"${escapeLike(t)}"%`} ESCAPE '\\'`,
          ),
        );
        if (tagCond) conditions.push(tagCond);
      }

      // 一篇论文可能对应多行 paper_results(历史脏数据或重复处理),
      // 不 groupBy 会因笛卡尔积扇出让同一篇在列表里出现两次。
      const rows = await ctx.db
        .select({
          id: papers.id,
          shortId: papers.shortId,
          title: papers.title,
          status: papers.status,
          pageCount: papers.pageCount,
          isPublic: papers.isPublic,
          errorMessage: papers.errorMessage,
          createdAt: papers.createdAt,
          tldr: paperResults.tldr,
          summaries: paperResults.summaries,
          tags: paperResults.tags,
          // 单个 max() 聚合让 SQLite 保证同组裸列取自该行(文档化行为),
          // 脏数据下多行 paper_results 时固定取最新那条,否则取到哪行是任意的。
          latestResultAt: sql<number>`max(${paperResults.createdAt})`,
        })
        .from(papers)
        .leftJoin(paperResults, eq(paperResults.paperId, papers.id))
        .where(and(...conditions))
        .groupBy(papers.id)
        // createdAt 是整秒精度,arxiv-cron 批量插入必然撞秒。offset 分页没有
        // tiebreaker 时跨页顺序不确定,会静默漏行(前端跨页去重只能挡重复,救不回漏的)。
        .orderBy(desc(papers.createdAt), desc(papers.id))
        .limit(input.limit)
        .offset(offset);

      // total 只在首屏算一次: 无限滚动每翻一页都跑一次 count 是纯浪费,
      // 前端读 pages[0].total。非首屏返回 null,调用方读 pages[0].total。
      let total: number | null = null;
      if (offset === 0) {
        const [totalResult] = await ctx.db
          .select({ count: countDistinct(papers.id) })
          .from(papers)
          .leftJoin(paperResults, eq(paperResults.paperId, papers.id))
          .where(and(...conditions));
        total = totalResult?.count ?? 0;
      }

      return {
        // 服务端按语言解析出短文本 tldr, 不把完整 summaries 打到客户端。
        papers: rows.map((row) => ({
          id: row.id,
          shortId: row.shortId,
          title: row.title,
          status: row.status,
          pageCount: row.pageCount,
          isPublic: row.isPublic,
          errorMessage: row.errorMessage,
          createdAt: row.createdAt,
          tldr: resolveTldr(row.tldr, row.summaries, localeKey),
          tags: row.tags ?? [],
        })),
        total,
        nextCursor:
          rows.length === input.limit ? offset + rows.length : undefined,
      };
    }),

  /**
   * 列表页顶部两枚状态 chip 的计数。
   * 口径是全库(只按 userId + 未删除过滤),刻意不受搜索/主题筛选影响 ——
   * 它的语义是「你有 1 篇失败了」这样的提醒,不是筛选结果统计;
   * 跟着搜索走会让 chip 在用户打字时闪来闪去。
   */
  statusCounts: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ status: papers.status, c: count() })
      .from(papers)
      .where(
        and(eq(papers.userId, ctx.session.user.id), isNull(papers.deletedAt)),
      )
      .groupBy(papers.status);

    let processing = 0;
    let failed = 0;
    for (const row of rows) {
      if (isInFlightPaperStatus(row.status)) {
        processing += row.c;
      } else if (row.status === "failed") {
        failed += row.c;
      }
    }
    return { processing, failed };
  }),

  /**
   * Get paper by ID with results
   * Public endpoint - allows viewing public papers without auth
   */
  getById: publicProcedure
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      // Try to get session (optional for public papers)
      const session =
        (await ctx.auth.api.getSession({ headers: ctx.headers })) ??
        (isReviewGuestModeEnabled()
          ? await getReviewGuestServerSession(ctx.db)
          : null);

      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(and(eq(papers.id, input), isNull(papers.deletedAt)))
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      // Check permission: owner or public paper
      const isOwner = session && paper.userId === session.user.id;
      if (!isOwner && !paper.isPublic) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to view this paper",
        });
      }

      // 获取结果（如果有）
      const [result] = await ctx.db
        .select()
        .from(paperResults)
        .where(eq(paperResults.paperId, input))
        .limit(1);

      // 获取所有白板图片
      const whiteboards = await ctx.db
        .select({
          id: whiteboardImages.id,
          imageR2Key: whiteboardImages.imageR2Key,
          promptId: whiteboardImages.promptId,
          promptName: whiteboardPrompts.name,
          isDefault: whiteboardImages.isDefault,
          createdAt: whiteboardImages.createdAt,
        })
        .from(whiteboardImages)
        .leftJoin(
          whiteboardPrompts,
          eq(whiteboardImages.promptId, whiteboardPrompts.id),
        )
        .where(eq(whiteboardImages.paperId, input))
        .orderBy(desc(whiteboardImages.createdAt));

      // 从结果中找到默认白板
      const defaultWhiteboard = whiteboards.find((w) => w.isDefault) || null;

      // 如果有结果，返回当前语言的摘要
      if (result) {
        const summaries = result.summaries as Record<string, string>;
        const currentLanguage = result.summaryLanguage;
        const summary = summaries[currentLanguage] || summaries.en || "";

        return {
          paper,
          result: {
            ...result,
            summary, // 返回当前语言的摘要
            summaries, // 返回所有已缓存语言的摘要
            availableLanguages: Object.keys(summaries), // 返回可用的语言列表
          },
          defaultWhiteboard: defaultWhiteboard || null,
          whiteboards,
        };
      }

      return {
        paper,
        result: null,
        defaultWhiteboard: null,
        whiteboards: [],
      };
    }),

  /**
   * Get paper by short ID with results
   * Public endpoint - allows viewing public papers without auth
   */
  getByShortId: publicProcedure
    .input(z.string().min(1).max(10))
    .query(async ({ ctx, input }) => {
      const session =
        (await ctx.auth.api.getSession({ headers: ctx.headers })) ??
        (isReviewGuestModeEnabled()
          ? await getReviewGuestServerSession(ctx.db)
          : null);

      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(and(eq(papers.shortId, input), isNull(papers.deletedAt)))
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      const isOwner = session && paper.userId === session.user.id;
      if (!isOwner && !paper.isPublic) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to view this paper",
        });
      }

      const [result] = await ctx.db
        .select()
        .from(paperResults)
        .where(eq(paperResults.paperId, paper.id))
        .limit(1);

      const whiteboards = await ctx.db
        .select({
          id: whiteboardImages.id,
          imageR2Key: whiteboardImages.imageR2Key,
          promptId: whiteboardImages.promptId,
          promptName: whiteboardPrompts.name,
          isDefault: whiteboardImages.isDefault,
          createdAt: whiteboardImages.createdAt,
        })
        .from(whiteboardImages)
        .leftJoin(
          whiteboardPrompts,
          eq(whiteboardImages.promptId, whiteboardPrompts.id),
        )
        .where(eq(whiteboardImages.paperId, paper.id))
        .orderBy(desc(whiteboardImages.createdAt));

      const defaultWhiteboard = whiteboards.find((w) => w.isDefault) || null;

      // 存量论文（pdfjs 回退 / MinerU 重构前入库）没有 paper_contents 行，
      // 详情页据此把「原文阅读」置灰，而不是让人点进一个空态。
      const [content] = await ctx.db
        .select({ id: paperContents.id })
        .from(paperContents)
        .where(eq(paperContents.paperId, paper.id))
        .limit(1);
      const hasContent = !!content;

      if (result) {
        const summaries = result.summaries as Record<string, string>;
        const currentLanguage = result.summaryLanguage;
        const summary = summaries[currentLanguage] || summaries.en || "";

        return {
          paper,
          result: {
            ...result,
            summary,
            summaries,
            availableLanguages: Object.keys(summaries),
          },
          defaultWhiteboard,
          whiteboards,
          hasContent,
        };
      }

      return {
        paper,
        result: null,
        defaultWhiteboard: null,
        whiteboards: [],
        hasContent,
      };
    }),

  /**
   * 原文 markdown（MinerU 解析产物）。公开论文匿名可读，私有论文仅 owner。
   * 无 paper_contents 行（pdfjs 回退/存量论文）返回 available: false。
   */
  getContent: publicProcedure
    .input(z.object({ paperId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [paper] = await ctx.db
        .select({
          id: papers.id,
          userId: papers.userId,
          isPublic: papers.isPublic,
        })
        .from(papers)
        .where(and(eq(papers.id, input.paperId), isNull(papers.deletedAt)))
        .limit(1);

      if (!paper) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Paper not found" });
      }
      // 公开论文匿名可读：段落深链（?view=reader#anchor）分享出去后，收到链接的人
      // 不该被一堵 GitHub 登录墙挡住——这篇论文的摘要与白板本来就已经匿名可见了。
      // 只有私有论文才需要解析 session，公开路径因此省掉一次 session 查库。
      // 端点鉴权与 /api/paper-content/$（正文内图片）必须保持同一套规则。
      if (!paper.isPublic) {
        const session =
          (await ctx.auth.api.getSession({ headers: ctx.headers })) ??
          (isReviewGuestModeEnabled()
            ? await getReviewGuestServerSession(ctx.db)
            : null);
        if (!session) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You must be logged in to access this resource",
          });
        }
        if (paper.userId !== session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You don't have permission to view this paper",
          });
        }
      }

      const [content] = await ctx.db
        .select()
        .from(paperContents)
        .where(eq(paperContents.paperId, paper.id))
        .limit(1);

      if (!content) {
        return { available: false as const };
      }

      const obj = await ctx.env.PAPERS_BUCKET.get(content.markdownR2Key);
      if (!obj) {
        return { available: false as const };
      }

      return {
        available: true as const,
        markdown: await obj.text(),
        imageBase: `/api/paper-content/${paper.id}/images/`,
      };
    }),

  /**
   * Related papers for the detail-page internal-link module. Shares any category
   * slug first, then fills with recent public papers. Public/listed only.
   */
  listRelated: publicProcedure
    .input(z.string().min(1).max(10))
    .query(async ({ ctx, input }) => {
      const [paper] = await ctx.db
        .select({ id: papers.id })
        .from(papers)
        .where(
          and(
            eq(papers.shortId, input),
            eq(papers.isPublic, true),
            isNull(papers.deletedAt),
          ),
        )
        .limit(1);
      if (!paper) return [];

      const [result] = await ctx.db
        .select({ categories: paperResults.categories })
        .from(paperResults)
        .where(eq(paperResults.paperId, paper.id))
        .limit(1);

      return selectRelatedPapers(ctx.db, {
        excludePaperId: paper.id,
        categories: result?.categories ?? [],
        limit: 3,
      });
    }),

  /**
   * Soft delete a paper
   */
  delete: protectedProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);
      const result = await ctx.db
        .update(papers)
        .set({ deletedAt: new Date() })
        .where(
          and(eq(papers.id, input), eq(papers.userId, ctx.session.user.id)),
        )
        .returning();

      if (result.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      return { success: true };
    }),

  /**
   * Regenerate summary in a different language
   * Does NOT deduct credits - just translates existing summary
   * Caches translations so switching back doesn't require re-translation
   */
  regenerateSummary: protectedProcedure
    .input(
      z.object({
        paperId: z.string().uuid(),
        language: z.enum(["en", "zh-cn", "zh-tw", "ja"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);
      const userId = ctx.session.user.id;

      // Step 1: Check if paper exists and belongs to user
      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(
          and(
            eq(papers.id, input.paperId),
            eq(papers.userId, userId),
            isNull(papers.deletedAt),
          ),
        )
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      // Step 2: Check if paper is completed
      if (paper.status !== "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paper processing is not completed yet",
        });
      }

      // Step 3: Get existing result
      const [existingResult] = await ctx.db
        .select()
        .from(paperResults)
        .where(eq(paperResults.paperId, input.paperId))
        .limit(1);

      if (!existingResult) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper results not found",
        });
      }

      const summaries = existingResult.summaries as Record<string, string>;

      // Step 4: Check if target language already exists
      if (summaries[input.language]) {
        // Language already exists, just update the current language
        await ctx.db
          .update(paperResults)
          .set({
            summaryLanguage: input.language,
          })
          .where(eq(paperResults.paperId, input.paperId));

        return {
          success: true,
          summary: summaries[input.language],
          language: input.language,
          cached: true,
        };
      }

      // Step 5: Translate from current language to target language
      const currentLanguage = existingResult.summaryLanguage;
      const sourceSummary = summaries[currentLanguage];

      if (!sourceSummary) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Source summary not found",
        });
      }

      const aiConfig: AIConfig = {
        openaiApiKey: ctx.env.OPENAI_API_KEY,
        openaiBaseUrl: ctx.env.OPENAI_BASE_URL,
        openaiModel: ctx.env.OPENAI_MODEL,
        geminiApiKey: ctx.env.GEMINI_API_KEY,
        geminiBaseUrl: ctx.env.GEMINI_BASE_URL,
        geminiModel: ctx.env.GEMINI_MODEL,
        cfApiToken: ctx.env.CF_API_TOKEN,
      };

      const translatedSummary = await translateSummary(
        sourceSummary,
        input.language,
        aiConfig,
      );

      // Step 6: Save the new translation and update current language
      const updatedSummaries = {
        ...summaries,
        [input.language]: translatedSummary,
      };

      await ctx.db
        .update(paperResults)
        .set({
          summaries: updatedSummaries,
          summaryLanguage: input.language,
        })
        .where(eq(paperResults.paperId, input.paperId));

      return {
        success: true,
        summary: translatedSummary,
        language: input.language,
        cached: false,
      };
    }),

  /**
   * Toggle paper public status
   * Only owner can toggle, and paper must be completed.
   * 白板是可选产物，公开分享不再以它为前提（上架画廊仍然要求，见
   * toggleGalleryListing）。
   */
  togglePublic: protectedProcedure
    .input(z.object({ paperId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);
      const userId = ctx.session.user.id;

      // Check if paper exists and belongs to user
      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(
          and(
            eq(papers.id, input.paperId),
            eq(papers.userId, userId),
            isNull(papers.deletedAt),
          ),
        )
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      // Check if paper is completed
      if (paper.status !== "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paper must be completed before sharing",
        });
      }

      // Toggle public status
      const newIsPublic = !paper.isPublic;
      const [updatedPaper] = await ctx.db
        .update(papers)
        .set({
          isPublic: newIsPublic,
          isListedInGallery: newIsPublic ? paper.isListedInGallery : false,
          publishedAt:
            newIsPublic && paper.isListedInGallery ? paper.publishedAt : null,
        })
        .where(eq(papers.id, input.paperId))
        .returning();

      // 只有真正对外可见的论文才值得通知 IndexNow。
      if (updatedPaper.isPublic && updatedPaper.isListedInGallery) {
        pingIndexNow(ctx.env, updatedPaper.shortId);
      }

      return {
        success: true,
        isPublic: updatedPaper.isPublic,
        isListedInGallery: updatedPaper.isListedInGallery,
      };
    }),

  /**
   * Toggle paper gallery listing status
   * Only owner can toggle after paper is public and completed with whiteboard
   */
  toggleGalleryListing: protectedProcedure
    .input(z.object({ paperId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);
      const userId = ctx.session.user.id;

      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(
          and(
            eq(papers.id, input.paperId),
            eq(papers.userId, userId),
            isNull(papers.deletedAt),
          ),
        )
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      if (!paper.isPublic) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paper must be public before listing in gallery",
        });
      }

      if (paper.status !== "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paper must be completed before listing in gallery",
        });
      }

      const [whiteboard] = await ctx.db
        .select()
        .from(whiteboardImages)
        .where(eq(whiteboardImages.paperId, input.paperId))
        .limit(1);

      if (!whiteboard) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paper must have whiteboard image before listing in gallery",
        });
      }

      const newIsListedInGallery = !paper.isListedInGallery;
      let updatedPaper: typeof papers.$inferSelect;
      try {
        const [row] = await ctx.db
          .update(papers)
          .set({
            isListedInGallery: newIsListedInGallery,
            publishedAt: newIsListedInGallery ? new Date() : null,
          })
          .where(eq(papers.id, input.paperId))
          .returning();
        updatedPaper = row;
      } catch (error) {
        // create 改为按 canonical 形式落 source_url 之后，用户自己导入的论文与
        // arxiv-cron 收录的同一篇会完全同形，上架时才真正撞得到 partial unique
        // index papers_gallery_source_url_unique。裸抛是 500，翻成 CONFLICT。
        // drizzle 把真实的 SQLite 报错裹进 DrizzleQueryError.cause，沿链取全文
        const texts: string[] = [];
        for (let e: unknown = error; e instanceof Error; e = e.cause) {
          texts.push(e.message);
        }
        if (/unique constraint failed/i.test(texts.join(" "))) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another paper with this source URL is already in gallery",
          });
        }
        throw error;
      }

      // 上架画廊即首次对外可见, 通知 IndexNow 抓取。
      if (updatedPaper.isPublic && updatedPaper.isListedInGallery) {
        pingIndexNow(ctx.env, updatedPaper.shortId);
      }

      return {
        success: true,
        isPublic: updatedPaper.isPublic,
        isListedInGallery: updatedPaper.isListedInGallery,
      };
    }),

  /**
   * List public papers for gallery
   * Accessible by everyone (no auth required)
   */
  listPublic: publicProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
        locale: z.enum(["en", "zh-CN", "zh-TW", "ja"]).optional(),
        q: z.string().trim().max(100).optional(),
        categories: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        sort: z.enum(["recent", "popular"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.limit;
      const localeKey = normalizeLocaleKey(input.locale);

      const sort = parseSort(input.sort);

      // 基础可见性条件(列表与计数共用)
      const baseConditions = [
        eq(papers.isPublic, true),
        eq(papers.isListedInGallery, true),
        eq(papers.status, "completed"),
        isNull(papers.deletedAt),
      ];

      // 「最热」只看最近一个月(滚动 30 天): upvotes 仅对近期 HF 论文有意义,
      // 限定时间窗让「最热」= 当月热门, 而非被历史高赞长期霸榜。
      if (sort === "popular") {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        baseConditions.push(gte(papers.publishedAt, cutoff));
      }

      // 搜索: 标题 + 当前语言 tldr/summary + tags(LIKE, CJK 子串友好)
      if (input.q) {
        const needle = `%${escapeLike(input.q)}%`;
        const localePath = `$."${localeKey}"`;
        const searchCond = or(
          sql`${papers.title} LIKE ${needle} ESCAPE '\\'`,
          sql`json_extract(${paperResults.tldr}, ${localePath}) LIKE ${needle} ESCAPE '\\'`,
          sql`json_extract(${paperResults.summaries}, ${localePath}) LIKE ${needle} ESCAPE '\\'`,
          sql`${paperResults.tags} LIKE ${needle} ESCAPE '\\'`,
        );
        if (searchCond) baseConditions.push(searchCond);
      }

      // 分类筛选(多选 OR): paper 的 categories JSON 包含任一所选 slug
      const cats = normalizeCategorySlugs(input.categories ?? []);
      if (cats.length > 0) {
        const catCond = or(
          ...cats.map(
            (slug) => sql`${paperResults.categories} LIKE ${`%"${slug}"%`}`,
          ),
        );
        if (catCond) baseConditions.push(catCond);
      }

      // tag 筛选(多选 OR): tags JSON 包含任一所选 tag
      const tagList = (input.tags ?? [])
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (tagList.length > 0) {
        const tagCond = or(
          ...tagList.map((t) => sql`${paperResults.tags} LIKE ${`%"${t}"%`}`),
        );
        if (tagCond) baseConditions.push(tagCond);
      }

      // Query public papers with default whiteboard images.
      // join paper_results 以拿到 tldr / summaries (用于卡片摘要文字)。
      const rows = await ctx.db
        .select({
          id: papers.id,
          shortId: papers.shortId,
          title: papers.title,
          publishedAt: papers.publishedAt,
          whiteboardImageR2Key: whiteboardImages.imageR2Key,
          tldr: paperResults.tldr,
          summaries: paperResults.summaries,
          tags: paperResults.tags,
        })
        .from(papers)
        .innerJoin(
          whiteboardImages,
          and(
            eq(papers.id, whiteboardImages.paperId),
            eq(whiteboardImages.isDefault, true),
          ),
        )
        .leftJoin(paperResults, eq(paperResults.paperId, papers.id))
        .where(and(...baseConditions))
        // 一篇论文可能对应多张默认白板 / 多行 paper_results(历史脏数据或重复处理),
        // 按 papers.id 聚合, 保证每篇论文只返回一行, 避免卡片重复(笛卡尔积扇出)。
        .groupBy(papers.id)
        .orderBy(
          sort === "popular" ? desc(papers.upvotes) : desc(papers.publishedAt),
        )
        .limit(input.limit)
        .offset(offset);

      // 服务端按语言解析出一段短文本 tldr, 只把短文本返回给前端
      // (不把完整 summaries 打到客户端)。
      const publicPapers = rows.map((row) => ({
        id: row.id,
        shortId: row.shortId,
        title: row.title,
        publishedAt: row.publishedAt,
        whiteboardImageR2Key: row.whiteboardImageR2Key,
        tldr: resolveTldr(row.tldr, row.summaries, localeKey),
        tags: row.tags ?? [],
      }));

      const [totalResult] = await ctx.db
        // countDistinct: 同上, join 可能放大行数, 用 distinct paper id 统计真实论文数。
        .select({ count: countDistinct(papers.id) })
        .from(papers)
        .innerJoin(
          whiteboardImages,
          and(
            eq(papers.id, whiteboardImages.paperId),
            eq(whiteboardImages.isDefault, true),
          ),
        )
        .leftJoin(paperResults, eq(paperResults.paperId, papers.id))
        .where(and(...baseConditions));

      return {
        papers: publicPapers,
        total: totalResult.count,
      };
    }),

  /**
   * List all whiteboard images for a paper
   * Public endpoint - allows viewing whiteboards for public papers
   */
  listWhiteboards: publicProcedure
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      // Try to get session (optional for public papers)
      const session =
        (await ctx.auth.api.getSession({ headers: ctx.headers })) ??
        (isReviewGuestModeEnabled()
          ? await getReviewGuestServerSession(ctx.db)
          : null);

      // Check if paper exists
      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(and(eq(papers.id, input), isNull(papers.deletedAt)))
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      // Check permission: owner or public paper
      const isOwner = session && paper.userId === session.user.id;
      if (!isOwner && !paper.isPublic) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to view this paper",
        });
      }

      // Query all whiteboard images with left join to whiteboardPrompts for prompt name
      const whiteboards = await ctx.db
        .select({
          id: whiteboardImages.id,
          imageR2Key: whiteboardImages.imageR2Key,
          promptId: whiteboardImages.promptId,
          promptName: whiteboardPrompts.name,
          isDefault: whiteboardImages.isDefault,
          createdAt: whiteboardImages.createdAt,
        })
        .from(whiteboardImages)
        .leftJoin(
          whiteboardPrompts,
          eq(whiteboardImages.promptId, whiteboardPrompts.id),
        )
        .where(eq(whiteboardImages.paperId, input))
        .orderBy(desc(whiteboardImages.createdAt));

      return { whiteboards };
    }),

  /**
   * Set a specific whiteboard as the default for a paper
   * Only one whiteboard per paper can be default
   */
  setDefaultWhiteboard: protectedProcedure
    .input(
      z.object({
        paperId: z.string().uuid(),
        whiteboardId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);
      const userId = ctx.session.user.id;

      // Step 1: Verify paper exists and belongs to user
      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(
          and(
            eq(papers.id, input.paperId),
            eq(papers.userId, userId),
            isNull(papers.deletedAt),
          ),
        )
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      // Step 2: Verify whiteboard exists and belongs to the paper
      const [whiteboard] = await ctx.db
        .select()
        .from(whiteboardImages)
        .where(
          and(
            eq(whiteboardImages.id, input.whiteboardId),
            eq(whiteboardImages.paperId, input.paperId),
          ),
        )
        .limit(1);

      if (!whiteboard) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Whiteboard not found",
        });
      }

      // Step 3: Atomic update to set isDefault
      // Use SQL CASE to update all whiteboards in a single operation
      // This prevents race conditions that could occur with two sequential updates
      try {
        await ctx.db
          .update(whiteboardImages)
          .set({
            isDefault: sql`CASE WHEN ${whiteboardImages.id} = ${input.whiteboardId} THEN 1 ELSE 0 END`,
          })
          .where(eq(whiteboardImages.paperId, input.paperId));
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update default whiteboard",
          cause: error,
        });
      }

      return { success: true };
    }),

  /**
   * Delete a whiteboard image
   * Must keep at least one whiteboard per paper
   * If deleting default, auto-set another as default
   */
  deleteWhiteboard: protectedProcedure
    .input(
      z.object({
        paperId: z.string().uuid(),
        whiteboardId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);
      const userId = ctx.session.user.id;

      // Step 1: Verify paper exists and belongs to user
      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(
          and(
            eq(papers.id, input.paperId),
            eq(papers.userId, userId),
            isNull(papers.deletedAt),
          ),
        )
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      // Step 2: Verify whiteboard exists and belongs to the paper
      const [whiteboard] = await ctx.db
        .select()
        .from(whiteboardImages)
        .where(
          and(
            eq(whiteboardImages.id, input.whiteboardId),
            eq(whiteboardImages.paperId, input.paperId),
          ),
        )
        .limit(1);

      if (!whiteboard) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Whiteboard not found",
        });
      }

      // Step 3: Delete image from R2 first (before DB changes)
      try {
        await ctx.env.PAPERS_BUCKET.delete(whiteboard.imageR2Key);
      } catch (error) {
        // Log but continue - database cleanup is more important
        console.error("Failed to delete whiteboard from R2:", error);
      }

      // Step 4: Conditional delete - only delete if more than 1 whiteboard exists
      // This prevents TOCTOU race condition by combining check and delete atomically
      const deleteResult = await ctx.db
        .delete(whiteboardImages)
        .where(
          and(
            eq(whiteboardImages.id, input.whiteboardId),
            sql`(SELECT COUNT(*) FROM ${whiteboardImages} WHERE ${whiteboardImages.paperId} = ${input.paperId}) > 1`,
          ),
        )
        .returning();

      if (deleteResult.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Cannot delete the last whiteboard. At least one must remain.",
        });
      }

      // Step 5: If deleted whiteboard was default, atomically set latest one as default
      // Use CASE expression to update all whiteboards in single query
      if (whiteboard.isDefault) {
        await ctx.db
          .update(whiteboardImages)
          .set({
            isDefault: sql`CASE WHEN ${whiteboardImages.id} = (
              SELECT ${whiteboardImages.id}
              FROM ${whiteboardImages}
              WHERE ${whiteboardImages.paperId} = ${input.paperId}
              ORDER BY ${whiteboardImages.createdAt} DESC
              LIMIT 1
            ) THEN 1 ELSE 0 END`,
          })
          .where(eq(whiteboardImages.paperId, input.paperId));
      }

      return { success: true };
    }),

  /**
   * Regenerate whiteboard with same or different prompt
   * Deducts 1 credit if not using user API
   * Pushes to queue for async processing
   */
  regenerateWhiteboard: protectedProcedure
    .input(
      z.object({
        paperId: z.string().uuid(),
        promptId: z.string().uuid().optional(),
        useExistingPrompt: z.boolean().optional(),
        apiConfigId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);
      const userId = ctx.session.user.id;

      // Step 1: Verify paper exists, belongs to user, and status is "completed"
      const [paper] = await ctx.db
        .select()
        .from(papers)
        .where(
          and(
            eq(papers.id, input.paperId),
            eq(papers.userId, userId),
            isNull(papers.deletedAt),
          ),
        )
        .limit(1);

      if (!paper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paper not found",
        });
      }

      if (paper.status !== "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paper must be completed before regenerating whiteboard",
        });
      }

      // Step 2: Validate apiConfigId if provided
      if (input.apiConfigId) {
        const [apiConfig] = await ctx.db
          .select({ id: userApiConfigs.id })
          .from(userApiConfigs)
          .where(
            and(
              eq(userApiConfigs.id, input.apiConfigId),
              eq(userApiConfigs.userId, userId),
            ),
          )
          .limit(1);

        if (!apiConfig) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "API configuration not found",
          });
        }
      }

      // Step 3: Determine promptId to use
      let finalPromptId: string | undefined = input.promptId;

      if (input.useExistingPrompt) {
        // Get promptId from current default whiteboard
        const [defaultWhiteboard] = await ctx.db
          .select({ promptId: whiteboardImages.promptId })
          .from(whiteboardImages)
          .where(
            and(
              eq(whiteboardImages.paperId, input.paperId),
              eq(whiteboardImages.isDefault, true),
            ),
          )
          .limit(1);

        if (defaultWhiteboard?.promptId) {
          finalPromptId = defaultWhiteboard.promptId;
        }
      }

      // Step 4: Validate promptId if provided
      if (finalPromptId) {
        const [prompt] = await ctx.db
          .select({ id: whiteboardPrompts.id })
          .from(whiteboardPrompts)
          .where(
            and(
              eq(whiteboardPrompts.id, finalPromptId),
              eq(whiteboardPrompts.userId, userId),
            ),
          )
          .limit(1);

        if (!prompt) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Prompt template not found",
          });
        }
      }

      // Step 4.5: 抢锁。条件更新是原子的，同时到达的第二个请求拿不到行，直接被拒 ——
      // 「先读 flag 再写」会让两个请求都穿过检查、双双扣分。放在所有校验之后、扣分之前：
      // 校验失败的路径不会留下锁。锁由消费者在成功/失败路径清掉；本函数内的失败路径
      // （余额不足 / 入队失败）自行清回，见下方 releaseLock。
      const [locked] = await ctx.db
        .update(papers)
        .set({ whiteboardRegenerating: true, updatedAt: new Date() })
        .where(
          and(
            eq(papers.id, input.paperId),
            eq(papers.whiteboardRegenerating, false),
          ),
        )
        .returning({ id: papers.id });

      if (!locked) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Whiteboard generation already in progress",
        });
      }

      // 抢到锁之后的任何失败都必须把锁放回去；清锁本身失败不能再抛（会盖掉真正的错因），
      // 只记日志 —— 消费者那边还有一层防御性清理。
      const releaseLock = async () => {
        try {
          await ctx.db
            .update(papers)
            .set({ whiteboardRegenerating: false, updatedAt: new Date() })
            .where(eq(papers.id, input.paperId));
        } catch (error) {
          console.warn(
            `[regenerateWhiteboard:${input.paperId}] Failed to release whiteboard lock`,
            error,
          );
        }
      };

      // 抢锁之后到入队成功之间的每一条语句都可能抛（扣分、写流水、入队、乃至退款本身），
      // 逐个 catch 总会漏。整段包一层：任何抛出都先把锁放回去再原样上抛 —— 漏掉一条
      // 就会把这篇论文永久卡在「生成中」（消息没入队，消费者也就清不了锁）。
      try {
        // Step 5: Deduct credit if not using user API
        if (!input.apiConfigId) {
          const [updatedUser] = await ctx.db
            .update(user)
            .set({
              credits: sql`${user.credits} - 1`,
            })
            .where(and(eq(user.id, userId), sql`${user.credits} >= 1`))
            .returning();

          if (!updatedUser) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Insufficient credits. You need at least 1 credit.",
            });
          }

          // Record credit transaction
          await ctx.db.insert(creditTransactions).values({
            userId: userId,
            amount: -1,
            type: "consume",
            relatedPaperId: input.paperId,
            description: "Whiteboard regeneration",
          });
        }

        // Step 6: Push to queue for async processing
        try {
          await ctx.env.PAPER_QUEUE.send({
            type: "regenerate_whiteboard",
            paperId: input.paperId,
            userId: userId,
            promptId: finalPromptId,
            apiConfigId: input.apiConfigId,
          });
        } catch (error) {
          // Refund credit if queue dispatch fails
          if (!input.apiConfigId) {
            await ctx.db
              .update(user)
              .set({
                credits: sql`${user.credits} + 1`,
              })
              .where(eq(user.id, userId));

            await ctx.db.insert(creditTransactions).values({
              userId: userId,
              amount: 1,
              type: "refund",
              relatedPaperId: input.paperId,
              description:
                "Refund for failed whiteboard regeneration queue dispatch",
            });
          }

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Queue dispatch failed",
            cause: error,
          });
        }
      } catch (error) {
        await releaseLock();
        throw error;
      }

      return { success: true };
    }),
});
