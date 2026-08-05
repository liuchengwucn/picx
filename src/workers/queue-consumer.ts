import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
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
import type { PaperQueueMessage as QueueMessage } from "#/integrations/trpc/init";
import type { AIConfig } from "#/lib/ai";
import {
  classifyPaper,
  extractPaperTitle,
  generateSummary,
  generateTldr,
  generateWhiteboardImage,
  generateWhiteboardInsights,
  translateSummary,
  translateTldr,
} from "#/lib/ai";
import { decrypt } from "#/lib/crypto";
import type { MineruResult } from "#/lib/mineru";
import { createBatch, getBatchResult } from "#/lib/mineru";
import {
  buildImageResolver,
  parseMineruZip,
  rewriteImageRefs,
} from "#/lib/mineru-zip";
import {
  buildPseudoPages,
  markdownImagePath,
  markdownToPlainText,
  paperContentImageKey,
  paperContentMarkdownKey,
} from "#/lib/paper-content";
import { paperTextKey } from "#/lib/paper-text";
import {
  downloadArxivPDF,
  extractPDFText,
  PDFPageLimitError,
  trimPaperTail,
} from "#/lib/pdf";
import type { Env } from "#/types/env";

type PaperStatus =
  | "pending"
  | "parsing"
  | "processing_text"
  | "processing_image"
  | "completed"
  | "failed";

type PaperRow = typeof papers.$inferSelect;
type LogFn = (step: string, message: string) => void;
type LogWarnFn = (step: string, message: string, error?: unknown) => void;

// 队列消息契约统一在 #/integrations/trpc/init 的 PaperQueueMessage（生产端与消费端共用）

const MAX_RETRIES = 3;

// tldr 生成/翻译针对网关瞬时限流(429)/超时的重试次数。
// tldr 是「非关键步骤」(失败仅回退到 summary 兜底), 但每日 cron 批量入队时
// 这一步靠后的 4 连发最容易踩到限流, 故给较多次数 + 指数退避兜稳。
const TLDR_RETRIES = 5;

// 分类同样是「非关键步骤」(失败回退 ["other"]),但缺重试时一次瞬时
// API 抖动/截断就会把论文永久误分类成 other。给它和 tldr 同等的重试兜底。
const CLASSIFY_RETRIES = 3;

// MinerU 编排参数：短轮询预算内多数论文可完成；未完成转延迟消息；总超时回退 pdfjs。
const MINERU_SYNC_POLL_INTERVAL_MS = 10_000;
const MINERU_SYNC_POLL_BUDGET_MS = 90_000;
const MINERU_POLL_DELAY_SECONDS = 45;
const MINERU_TOTAL_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * 通用重试: 指数退避 + 抖动。最多重试 `retries` 次(共 retries+1 次尝试)。
 * 每次失败回调 `onRetry`(用于日志), 全部失败则抛出最后一次错误。
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    retries: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (attempt: number, error: unknown) => void;
  },
): Promise<T> {
  const { retries, baseDelayMs = 500, maxDelayMs = 8000, onRetry } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      onRetry?.(attempt + 1, error);
      // 指数退避 + ±25% 抖动, 避免多篇并发同时重试形成新的尖峰
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jitter = backoff * (0.75 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }
  throw lastError;
}

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const { paperId, type = "initial" } = message.body;
      const attempt = message.attempts;

      try {
        console.log(
          `[paper:${paperId}] Processing attempt ${attempt}/${MAX_RETRIES} (type: ${type})`,
        );

        // 根据消息类型路由到不同的处理函数
        if (type === "regenerate_whiteboard") {
          await processWhiteboardRegeneration(message.body, env);
        } else {
          await processPaper(message.body, env);
        }

        message.ack();
      } catch (error) {
        const errorDetail = formatErrorDetail(error);
        console.error(
          `[paper:${paperId}] Failed on attempt ${attempt}/${MAX_RETRIES}: ${errorDetail}`,
        );

        // 用户 API 配置错误：不重试，不退还 credit
        if (error instanceof UserApiConfigError) {
          await markPaperFailed(paperId, errorDetail, env);
          message.ack();
          continue;
        }

        // 最后一次重试也失败了，或者是不可重试的错误 → 标记 failed 并（按需）返还 credit
        if (attempt >= MAX_RETRIES || !isRetryableError(error)) {
          const reason =
            attempt >= MAX_RETRIES
              ? `Exhausted ${MAX_RETRIES} retries. Last error: ${errorDetail}`
              : errorDetail;
          if (type === "regenerate_whiteboard") {
            // regenerate 的扣费与 generateWhiteboard 无关（除 BYOK 外总是扣费），
            // 沿用原有退款路径，本次改动不触碰。
            await markPaperFailedAndRefund(
              paperId,
              message.body.userId,
              reason,
              env,
            );
          } else {
            await markPaperFailedForMessage(paperId, message.body, reason, env);
          }
          message.ack();
        } else {
          console.log(
            `[paper:${paperId}] Scheduling retry (attempt ${attempt + 1})`,
          );
          message.retry();
        }
      }
    }
  },
};

async function processPaper(msg: QueueMessage, env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const startTime = Date.now();
  const log = (step: string, message: string) =>
    console.log(`[paper:${msg.paperId}][${step}] ${message}`);
  const logWarn = (step: string, message: string, error?: unknown) =>
    console.warn(`[paper:${msg.paperId}][${step}] ${message}`, error ?? "");

  // 幂等守卫: Cloudflare Queues 是 at-least-once 投递, 同一条 initial 消息可能被重投。
  // 若该论文(按本条消息的 paperId, 不看 source_url / 是否在 gallery, 避免与私有论文混淆)
  // 已处理完成, 直接跳过, 既不重复写 paper_results / 白板, 也省掉 LLM 与出图开销。
  // 取整行：MinerU 编排还需要 mineruBatchId（防重复提交）与 pdfR2Key（回退取 PDF）。
  const [paperRow] = await db
    .select()
    .from(papers)
    .where(eq(papers.id, msg.paperId))
    .limit(1);

  if (!paperRow) {
    log("idempotency", "Paper not found, skipping");
    return;
  }

  if (paperRow.status === "completed") {
    log("idempotency", "Paper already completed, skipping duplicate delivery");
    return;
  }

  // Step 0: 读取 AI 配置（用户配置或系统配置）
  let aiConfig: AIConfig;

  if (msg.apiConfigId) {
    try {
      log("load-config", `Loading user API configuration: ${msg.apiConfigId}`);

      // 从数据库读取用户配置
      const [config] = await db
        .select()
        .from(userApiConfigs)
        .where(
          and(
            eq(userApiConfigs.id, msg.apiConfigId),
            eq(userApiConfigs.userId, msg.userId),
          ),
        )
        .limit(1);

      if (!config) {
        throw new UserApiConfigError(
          `User API configuration not found: ${msg.apiConfigId}`,
        );
      }

      // 解密 API keys
      const secret = env.API_KEY_ENCRYPTION_SECRET;
      if (!secret) {
        throw new Error("API_KEY_ENCRYPTION_SECRET is not configured");
      }

      aiConfig = {
        openaiApiKey: await decrypt(config.openaiApiKey, secret),
        openaiBaseUrl: config.openaiBaseUrl,
        openaiModel: config.openaiModel,
        geminiApiKey: await decrypt(config.geminiApiKey, secret),
        geminiBaseUrl: config.geminiBaseUrl,
        geminiModel: config.geminiModel,
      };

      log("load-config", `User API configuration loaded successfully`);
    } catch (error) {
      if (error instanceof UserApiConfigError) {
        throw error;
      }
      throw new UserApiConfigError(
        `Failed to load user API configuration: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    // 使用系统配置（现有逻辑）
    log("load-config", "Using system API configuration");
    aiConfig = {
      openaiApiKey: env.OPENAI_API_KEY,
      openaiBaseUrl: env.OPENAI_BASE_URL,
      openaiModel: env.OPENAI_MODEL,
      geminiApiKey: env.GEMINI_API_KEY,
      geminiBaseUrl: env.GEMINI_BASE_URL,
      geminiModel: env.GEMINI_MODEL,
      cfApiToken: env.CF_API_TOKEN,
    };
  }

  // Step 0.5: 读取自定义 Prompt 模板（如果提供；仅出白板时才需要）
  let customPromptTemplate: string | undefined;

  if (msg.generateWhiteboard === true && msg.promptId) {
    try {
      log("load-prompt", `Loading custom prompt template: ${msg.promptId}`);

      const [promptConfig] = await db
        .select()
        .from(whiteboardPrompts)
        .where(
          and(
            eq(whiteboardPrompts.id, msg.promptId),
            eq(whiteboardPrompts.userId, msg.userId),
          ),
        )
        .limit(1);

      if (!promptConfig) {
        logWarn(
          "load-prompt",
          `Custom prompt template not found: ${msg.promptId}, using default`,
        );
      } else {
        customPromptTemplate = promptConfig.promptTemplate;
        log("load-prompt", `Custom prompt template loaded successfully`);
      }
    } catch (error) {
      logWarn(
        "load-prompt",
        `Failed to load custom prompt template, using default`,
        error,
      );
    }
  }

  // Step 1 + 2: 正文提取。MinerU 为主路径（异步，状态机编排），任何失败/超时回退 pdfjs。
  let extraction: ExtractionOutcome | null;
  let r2Key = msg.r2Key;

  if (msg.type === "mineru_poll") {
    extraction = await resolveMineruPoll(
      msg,
      paperRow,
      aiConfig,
      env,
      log,
      logWarn,
    );
  } else {
    // Step 1: 获取 PDF
    let pdfBuffer: ArrayBuffer;

    try {
      if (!msg.sourceType) {
        throw new Error("sourceType is required for initial processing");
      }

      if (msg.sourceType === "arxiv") {
        if (!msg.arxivUrl) {
          throw new Error("arxivUrl is required for arxiv source type");
        }
        log("fetch-pdf", `Downloading arXiv PDF from ${msg.arxivUrl}`);
        pdfBuffer = await downloadArxivPDF(msg.arxivUrl);
        log("fetch-pdf", `Downloaded ${pdfBuffer.byteLength} bytes`);

        // 上传到 R2
        r2Key = `papers/${msg.userId}/${Date.now()}-arxiv-${msg.paperId}.pdf`;
        await env.PAPERS_BUCKET.put(r2Key, pdfBuffer);

        // 更新数据库中的 r2Key 和 fileSize
        await db
          .update(papers)
          .set({
            pdfR2Key: r2Key,
            fileSize: pdfBuffer.byteLength,
          })
          .where(eq(papers.id, msg.paperId));
      } else {
        if (!r2Key) {
          throw new Error("r2Key is required for upload source type");
        }
        log("fetch-pdf", `Reading from R2: ${r2Key}`);
        const object = await env.PAPERS_BUCKET.get(r2Key);
        if (!object) {
          throw new Error(`PDF file not found in R2: ${r2Key}`);
        }
        pdfBuffer = await object.arrayBuffer();
        log("fetch-pdf", `Read ${pdfBuffer.byteLength} bytes from R2`);
      }
    } catch (error) {
      throw new StepError("fetch-pdf", error);
    }

    // Step 2: 提交 MinerU 并短轮询（超预算转延迟消息，失败回退 pdfjs）
    extraction = await mineruSubmitAndWait(
      msg,
      paperRow,
      pdfBuffer,
      r2Key,
      aiConfig,
      env,
      log,
      logWarn,
    );
  }

  // null 表示已投递延迟 poll 消息，本条消息到此正常结束（ack）。
  if (!extraction) {
    return;
  }

  const { pageCount, rawText, text, pdfMetadataTitle } = extraction;

  await updatePaperStatus(msg.paperId, "processing_text", null, env);

  // 全文落盘 R2，供论文 chatbot 随取随用。失败不阻断主流程。
  try {
    await env.PAPERS_BUCKET.put(paperTextKey(msg.paperId), rawText);
    log("persist-text", `Persisted ${rawText.length} chars to R2`);
  } catch (persistError) {
    logWarn("persist-text", "Persist to R2 failed (non-fatal)", persistError);
  }

  // Step 3: 提取标题

  // 准备 fallback 标题
  const getFallbackTitle = (): string => {
    if (msg.sourceType === "arxiv" && msg.arxivUrl) {
      const arxivIdMatch = msg.arxivUrl.match(
        /arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/i,
      );
      if (arxivIdMatch) {
        return `arXiv:${arxivIdMatch[1]}`;
      }
    }

    if (r2Key) {
      const filename = r2Key.split("/").pop();
      if (filename) {
        const cleanName = filename.replace(/\.pdf$/i, "").replace(/^\d+-/, "");
        if (cleanName.length > 0) {
          return cleanName;
        }
      }
    }

    return `Paper ${msg.paperId.substring(0, 8)}`;
  };

  let paperTitle: string;
  if (pdfMetadataTitle && pdfMetadataTitle.trim().length > 0) {
    paperTitle = pdfMetadataTitle;
    log("extract-title", `Using PDF metadata title: ${paperTitle}`);
  } else {
    const textForTitleExtraction = rawText.substring(0, 3000);

    if (textForTitleExtraction.trim().length < 50) {
      logWarn(
        "extract-title",
        "Text too short for title extraction, using fallback",
      );
      paperTitle = getFallbackTitle();
    } else {
      try {
        paperTitle = await extractPaperTitle(textForTitleExtraction, aiConfig);
        log("extract-title", `Extracted title: ${paperTitle}`);
      } catch (error) {
        logWarn(
          "extract-title",
          "LLM title extraction failed, using fallback",
          error,
        );
        paperTitle = getFallbackTitle();
      }
    }
  }

  // 更新标题和页数（MinerU 未返回页数时不覆盖库里已有值）
  await db
    .update(papers)
    .set({
      title: paperTitle,
      ...(pageCount != null ? { pageCount } : {}),
    })
    .where(eq(papers.id, msg.paperId));

  // Step 4: 生成总结和白板洞察（并行执行）
  const language: "en" | "zh-cn" | "zh-tw" | "ja" = msg.language || "en";

  // 是否出白板由生产端决定（用户上传默认不出图，cron 传 true）
  const wantWhiteboard = msg.generateWhiteboard === true;

  let summary: string;
  let whiteboardInsights: string | null = null;
  let classification: { categories: string[]; tags: string[] } = {
    categories: ["other"],
    tags: [],
  };
  try {
    log(
      "generate-summary-and-whiteboard",
      `Generating summary${wantWhiteboard ? " and whiteboard insights" : ""} in parallel (text: ${text.length} chars, lang: ${language})`,
    );

    // 分类失败不应中断整篇处理:重试兜稳瞬时抖动,重试耗尽才回退 ["other"]。
    const classifyTask = withRetry(() => classifyPaper(text, aiConfig), {
      retries: CLASSIFY_RETRIES,
      onRetry: (attempt, error) =>
        log(
          "classify",
          `Classification retry ${attempt}/${CLASSIFY_RETRIES}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
    }).catch((error) => {
      console.error(
        `Classification failed after ${CLASSIFY_RETRIES} retries, defaulting to ["other"]:`,
        error,
      );
      return { categories: ["other"], tags: [] };
    });

    if (wantWhiteboard) {
      // 并行执行摘要生成和白板洞察生成
      [summary, whiteboardInsights, classification] = await Promise.all([
        generateSummary(text, aiConfig, language),
        generateWhiteboardInsights(text, aiConfig),
        classifyTask,
      ]);
    } else {
      [summary, classification] = await Promise.all([
        generateSummary(text, aiConfig, language),
        classifyTask,
      ]);
    }

    log(
      "generate-summary-and-whiteboard",
      `Summary (${summary.length} chars)${whiteboardInsights ? ` and whiteboard insights (${whiteboardInsights.length} chars)` : ""} generated`,
    );
  } catch (error) {
    const stepName =
      error instanceof Error && error.message.includes("Summary")
        ? "generate-summary"
        : "generate-whiteboard";
    throw new StepError(stepName, error);
  }

  // Step 4.5: 翻译额外语言（如 cron 任务需要多语言）
  const summaries: Record<string, string> = { [language]: summary };
  if (msg.extraLanguages && msg.extraLanguages.length > 0) {
    log(
      "translate-summary",
      `Translating to: ${msg.extraLanguages.join(", ")}`,
    );
    try {
      const translations = await Promise.all(
        msg.extraLanguages.map((lang) =>
          translateSummary(summary, lang, aiConfig),
        ),
      );
      for (let i = 0; i < msg.extraLanguages.length; i++) {
        summaries[msg.extraLanguages[i]] = translations[i];
      }
      log(
        "translate-summary",
        `Translated ${msg.extraLanguages.length} languages`,
      );
    } catch (error) {
      throw new StepError("translate-summary", error);
    }
  }

  // Step 4.6: 生成多语言 TL;DR (用于 gallery 卡片)
  // 非关键步骤: 失败不应中断论文处理, 读取时可从 summaries 兜底。
  // 每个语言独立重试、独立成败: 某个翻译失败只丢该语言, 不再「全有或全无」。
  // 仅当 base tldr 重试耗尽才整体放弃(无 base 无法翻译), 读取时回退 summary。
  let tldr: Record<string, string> | undefined;
  let baseTldr: string | null = null;
  try {
    baseTldr = await withRetry(
      () => generateTldr(summary, aiConfig, language),
      {
        retries: TLDR_RETRIES,
        onRetry: (attempt, error) =>
          logWarn(
            "generate-tldr",
            `Base tldr generation retry ${attempt}/${TLDR_RETRIES} (${language})`,
            error,
          ),
      },
    );
  } catch (error) {
    logWarn(
      "generate-tldr",
      `Base tldr generation failed after ${TLDR_RETRIES} retries, gallery will fall back to summary`,
      error,
    );
  }

  if (baseTldr) {
    const result: Record<string, string> = { [language]: baseTldr };
    const others = (msg.extraLanguages ?? []).filter((l) => l !== language);

    if (others.length > 0) {
      const settled = await Promise.allSettled(
        others.map((lang) =>
          withRetry(() => translateTldr(baseTldr as string, lang, aiConfig), {
            retries: TLDR_RETRIES,
            onRetry: (attempt, error) =>
              logWarn(
                "generate-tldr",
                `Tldr translation retry ${attempt}/${TLDR_RETRIES} (${lang})`,
                error,
              ),
          }),
        ),
      );
      const failed: string[] = [];
      settled.forEach((s, i) => {
        if (s.status === "fulfilled") {
          result[others[i]] = s.value;
        } else {
          failed.push(others[i]);
          logWarn(
            "generate-tldr",
            `Tldr translation gave up for ${others[i]} after ${TLDR_RETRIES} retries`,
            s.reason,
          );
        }
      });
      if (failed.length > 0) {
        logWarn(
          "generate-tldr",
          `Tldr partially generated: kept [${Object.keys(result).join(", ")}], missing [${failed.join(", ")}]`,
        );
      }
    }

    tldr = result;
    log(
      "generate-tldr",
      `Generated tldr in ${Object.keys(tldr).length} language(s)`,
    );
  } else {
    tldr = undefined;
  }

  // Step 5: 生成白板图片（仅当本条消息要求出图）
  let imageData: ArrayBuffer | null = null;
  let imageR2Key: string | null = null;
  if (wantWhiteboard && whiteboardInsights) {
    await updatePaperStatus(msg.paperId, "processing_image", null, env);
    try {
      log(
        "generate-image",
        `Generating whiteboard image (model: ${aiConfig.geminiModel || "default"}, baseUrl: ${aiConfig.geminiBaseUrl || "default"})`,
      );
      const whiteboardLang = msg.whiteboardLanguage || "en";
      const result = await generateWhiteboardImage(
        whiteboardInsights,
        text,
        aiConfig,
        whiteboardLang,
        summary, // 传递摘要作为降级选项
        customPromptTemplate, // 传递自定义 prompt 模板
      );
      imageData = result.imageData;
      log("generate-image", `Image generated: ${imageData.byteLength} bytes`);
    } catch (error) {
      throw new StepError("generate-image", error);
    }
    imageR2Key = `whiteboards/${msg.paperId}/${crypto.randomUUID()}.png`;
  } else if (wantWhiteboard) {
    // 理论上不可达（insights 生成失败会抛错），留日志避免静默少图。
    logWarn("generate-image", "Whiteboard insights are empty, skipping image");
  }

  // Step 6: 上传图片到 R2 和保存结果到数据库（并行执行）
  const processingTimeMs = Date.now() - startTime;

  // 幂等清理: 顶部守卫已挡掉「已 completed 的重投」; 这里覆盖另一种情况——
  // 上一次处理写入 paper_results/白板后、标记 completed 前崩溃, 重试重跑到这里。
  // 此时 status 仍是 processing_*, 不会被守卫跳过, 若不先清理就会插出第二行。
  // 初始处理阶段论文刚创建, 不存在用户合法的多份结果, 直接清空既有结果再写。
  await db.delete(paperResults).where(eq(paperResults.paperId, msg.paperId));
  if (imageR2Key) {
    await db
      .delete(whiteboardImages)
      .where(eq(whiteboardImages.paperId, msg.paperId));
  }

  await Promise.all([
    // 上传图片到 R2
    ...(imageR2Key && imageData
      ? [
          env.PAPERS_BUCKET.put(imageR2Key, imageData, {
            httpMetadata: { contentType: "image/png" },
          }),
        ]
      : []),
    // 保存结果到数据库
    db
      .insert(paperResults)
      .values({
        paperId: msg.paperId,
        summaries: summaries,
        tldr: tldr,
        categories: classification.categories,
        tags: classification.tags,
        summaryLanguage: language,
        whiteboardInsights: whiteboardInsights,
        processingTimeMs,
      }),
    // 保存白板图片记录
    ...(imageR2Key
      ? [
          db.insert(whiteboardImages).values({
            paperId: msg.paperId,
            imageR2Key: imageR2Key,
            promptId: msg.promptId || null,
            isDefault: true,
          }),
        ]
      : []),
  ]);

  // Step 7: 标记完成
  await updatePaperStatus(msg.paperId, "completed", null, env);
  log("done", `Completed in ${processingTimeMs}ms`);
}

/** 正文提取结果，MinerU 与 pdfjs 两条路径归一。 */
interface ExtractionOutcome {
  /** MinerU 未给出总页数时为 null —— 此时不覆盖 papers.page_count。 */
  pageCount: number | null;
  /** 全文，落 paper-text 供 chatbot 使用。 */
  rawText: string;
  /** 裁掉参考文献/附录后的正文，喂 LLM。 */
  text: string;
  pdfMetadataTitle?: string;
  /** MinerU 路径 true（paper_contents 已写）；pdfjs 回退 false。 */
  contentPersisted: boolean;
}

/**
 * initial 消息的提取路径：提交 MinerU（若尚未提交）并在预算内短轮询。
 * 预算内未完成 → 投递延迟 mineru_poll 消息并返回 null（本条消息就此结束）。
 * MinerU 不可用 / 提交失败 / 解析失败 → 立即回退 pdfjs，保证论文仍能完成。
 */
async function mineruSubmitAndWait(
  msg: QueueMessage,
  paperRow: PaperRow,
  pdfBuffer: ArrayBuffer,
  r2Key: string | undefined,
  aiConfig: AIConfig,
  env: Env,
  log: LogFn,
  logWarn: LogWarnFn,
): Promise<ExtractionOutcome | null> {
  const token = env.MINERU_TOKEN;
  if (!token) {
    logWarn("mineru", "MINERU_TOKEN is not configured, falling back to pdfjs");
    return await extractViaPdfjs(pdfBuffer, aiConfig, msg, env, log);
  }

  const db = drizzle(env.DB);
  // 已落库的 batchId 是重投的幂等守卫：同一篇绝不重复提交 MinerU。
  let batchId = paperRow.mineruBatchId ?? undefined;
  const submittedAt = msg.mineruSubmittedAt ?? Date.now();

  if (batchId) {
    log("mineru-submit", `Reusing existing MinerU batch ${batchId}`);
  } else {
    try {
      const filename = r2Key?.split("/").pop() || `${msg.paperId}.pdf`;
      log(
        "mineru-submit",
        `Creating MinerU batch for ${filename} (${pdfBuffer.byteLength} bytes)`,
      );
      const created = await createBatch(token, {
        filename,
        size: pdfBuffer.byteLength,
      });
      // 绝不能设置 Content-Type：OSS 预签名里该字段为空，设了即签名不匹配 → 403。
      const uploadResp = await fetch(created.uploadUrl, {
        method: "PUT",
        body: pdfBuffer,
      });
      if (!uploadResp.ok) {
        throw new Error(
          `Upload PDF to MinerU storage failed with status ${uploadResp.status}`,
        );
      }
      batchId = created.batchId;

      await db
        .update(papers)
        .set({
          mineruBatchId: batchId,
          status: "parsing",
          updatedAt: new Date(),
        })
        .where(eq(papers.id, msg.paperId));
      log("mineru-submit", `Submitted to MinerU, batch ${batchId}`);
    } catch (error) {
      logWarn(
        "mineru-submit",
        "MinerU submission failed, falling back to pdfjs",
        error,
      );
      return await extractViaPdfjs(pdfBuffer, aiConfig, msg, env, log);
    }
  }

  // 短轮询：多数论文能在预算内解析完，省掉一次队列往返。
  const pollDeadline = Date.now() + MINERU_SYNC_POLL_BUDGET_MS;
  while (Date.now() < pollDeadline) {
    try {
      const result = await getBatchResult(token, batchId);
      if (result.state === "done") {
        const outcome = await persistMineruContent(
          msg.paperId,
          result,
          aiConfig,
          env,
          log,
          logWarn,
        );
        if (outcome) {
          return outcome;
        }
        return await extractViaPdfjs(pdfBuffer, aiConfig, msg, env, log);
      }
      if (result.state === "failed") {
        logWarn(
          "mineru-poll",
          `MinerU parse failed (${result.errMsg || "unknown"}), falling back to pdfjs`,
        );
        return await extractViaPdfjs(pdfBuffer, aiConfig, msg, env, log);
      }
      log("mineru-poll", `MinerU state=${result.state}, waiting`);
    } catch (error) {
      logWarn("mineru-poll", "MinerU status query failed, will retry", error);
    }
    await new Promise((resolve) =>
      setTimeout(resolve, MINERU_SYNC_POLL_INTERVAL_MS),
    );
  }

  try {
    await env.PAPER_QUEUE.send(
      {
        ...msg,
        type: "mineru_poll",
        mineruBatchId: batchId,
        mineruSubmittedAt: submittedAt,
        mineruPollAttempt: 1,
      } satisfies QueueMessage,
      { delaySeconds: MINERU_POLL_DELAY_SECONDS },
    );
    log(
      "mineru-poll",
      `Poll budget exhausted, handed off to delayed poll (batch ${batchId})`,
    );
    return null;
  } catch (error) {
    // 宁降级不丢单：延迟消息投不出去就地回退 pdfjs。
    logWarn(
      "mineru-poll",
      "Failed to enqueue delayed poll, falling back to pdfjs",
      error,
    );
    return await extractViaPdfjs(pdfBuffer, aiConfig, msg, env, log);
  }
}

/**
 * mineru_poll 消息的提取路径：查一次状态，完成则入库，未完成则续投延迟消息，
 * 超过总超时则回退 pdfjs。状态查询本身出错直接抛出，交给 Queues 原生重试。
 */
async function resolveMineruPoll(
  msg: QueueMessage,
  paperRow: PaperRow,
  aiConfig: AIConfig,
  env: Env,
  log: LogFn,
  logWarn: LogWarnFn,
): Promise<ExtractionOutcome | null> {
  const token = env.MINERU_TOKEN;
  const batchId = msg.mineruBatchId ?? paperRow.mineruBatchId ?? undefined;

  if (!token || !batchId) {
    logWarn(
      "mineru-poll",
      `Missing ${token ? "MinerU batch id" : "MINERU_TOKEN"}, falling back to pdfjs`,
    );
    return await extractViaPdfjs(
      await loadPdfFromR2(paperRow, env, log),
      aiConfig,
      msg,
      env,
      log,
    );
  }

  const attempt = msg.mineruPollAttempt ?? 1;
  // 抛错不吞：batchId 已落库，Queues 重投不会造成重复提交。
  const result = await getBatchResult(token, batchId);

  if (result.state === "done") {
    const outcome = await persistMineruContent(
      msg.paperId,
      result,
      aiConfig,
      env,
      log,
      logWarn,
    );
    if (outcome) {
      return outcome;
    }
    return await extractViaPdfjs(
      await loadPdfFromR2(paperRow, env, log),
      aiConfig,
      msg,
      env,
      log,
    );
  }

  if (result.state === "failed") {
    logWarn(
      "mineru-poll",
      `MinerU parse failed (${result.errMsg || "unknown"}), falling back to pdfjs`,
    );
    return await extractViaPdfjs(
      await loadPdfFromR2(paperRow, env, log),
      aiConfig,
      msg,
      env,
      log,
    );
  }

  const submittedAt = msg.mineruSubmittedAt ?? 0;
  if (Date.now() - submittedAt > MINERU_TOTAL_TIMEOUT_MS) {
    logWarn(
      "mineru-poll",
      `MinerU still ${result.state} after total timeout (attempt ${attempt}), falling back to pdfjs`,
    );
    return await extractViaPdfjs(
      await loadPdfFromR2(paperRow, env, log),
      aiConfig,
      msg,
      env,
      log,
    );
  }

  try {
    await env.PAPER_QUEUE.send(
      {
        ...msg,
        type: "mineru_poll",
        mineruBatchId: batchId,
        mineruSubmittedAt: submittedAt,
        mineruPollAttempt: attempt + 1,
      } satisfies QueueMessage,
      { delaySeconds: MINERU_POLL_DELAY_SECONDS },
    );
    log(
      "mineru-poll",
      `MinerU state=${result.state}, scheduled poll attempt ${attempt + 1}`,
    );
    return null;
  } catch (error) {
    logWarn(
      "mineru-poll",
      "Failed to enqueue next poll, falling back to pdfjs",
      error,
    );
    return await extractViaPdfjs(
      await loadPdfFromR2(paperRow, env, log),
      aiConfig,
      msg,
      env,
      log,
    );
  }
}

/** pdfjs 回退时重新取 PDF（arxiv 在提交阶段已把真实 key 回写 papers.pdf_r2_key）。 */
async function loadPdfFromR2(
  paperRow: PaperRow,
  env: Env,
  log: LogFn,
): Promise<ArrayBuffer> {
  try {
    log("fetch-pdf", `Reading from R2: ${paperRow.pdfR2Key}`);
    const object = await env.PAPERS_BUCKET.get(paperRow.pdfR2Key);
    if (!object) {
      throw new Error(`PDF file not found in R2: ${paperRow.pdfR2Key}`);
    }
    const buffer = await object.arrayBuffer();
    log("fetch-pdf", `Read ${buffer.byteLength} bytes from R2`);
    return buffer;
  } catch (error) {
    throw new StepError("fetch-pdf", error);
  }
}

/**
 * MinerU 解析产物入库：markdown + 图片落 R2 `paper-content/{paperId}/`，
 * 元信息落 paper_contents（delete + insert 幂等），再转出喂 LLM 的纯文本。
 * 返回 null 表示产物不可用，调用方应回退 pdfjs。
 */
async function persistMineruContent(
  paperId: string,
  result: MineruResult,
  aiConfig: AIConfig,
  env: Env,
  log: LogFn,
  logWarn: LogWarnFn,
): Promise<ExtractionOutcome | null> {
  if (!result.fullZipUrl) {
    logWarn("mineru-persist", "MinerU is done but returned no zip url");
    return null;
  }

  const db = drizzle(env.DB);

  let zipBytes: Uint8Array;
  try {
    log("mineru-persist", `Downloading result zip`);
    const resp = await fetch(result.fullZipUrl);
    if (!resp.ok) {
      throw new Error(
        `Downloading MinerU result zip failed with status ${resp.status}`,
      );
    }
    zipBytes = new Uint8Array(await resp.arrayBuffer());
  } catch (error) {
    // 网络类失败交给 Queues 重试（batchId 已落库，重跑不会重复提交）。
    throw new StepError("mineru-persist", error);
  }

  const { markdown, title, images } = parseMineruZip(zipBytes);
  if (markdown.trim().length === 0) {
    logWarn("mineru-persist", "MinerU zip has no usable markdown");
    return null;
  }

  const resolver = buildImageResolver(images, (img) =>
    markdownImagePath(img.storedName),
  );
  const rewritten = rewriteImageRefs(markdown, resolver);

  await Promise.all([
    ...images.map((img) =>
      env.PAPERS_BUCKET.put(
        paperContentImageKey(paperId, img.storedName),
        img.bytes,
        {
          httpMetadata: { contentType: img.mime },
        },
      ),
    ),
    env.PAPERS_BUCKET.put(paperContentMarkdownKey(paperId), rewritten, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    }),
  ]);

  // paper_id 唯一，重跑先删后插（D1 无事务，delete+insert 之间的空窗可接受：
  // 只有本条消息在写这一行，读侧拿不到内容时按「未解析」处理）。
  await db.delete(paperContents).where(eq(paperContents.paperId, paperId));
  await db.insert(paperContents).values({
    paperId,
    markdownR2Key: paperContentMarkdownKey(paperId),
    imageCount: images.length,
    charCount: rewritten.length,
  });
  log(
    "mineru-persist",
    `Persisted markdown (${rewritten.length} chars) and ${images.length} image(s)`,
  );

  const plainText = markdownToPlainText(rewritten);
  if (plainText.trim().length === 0) {
    logWarn("mineru-persist", "MinerU markdown produced empty plain text");
    return null;
  }

  let mainText = plainText;
  try {
    const pages = buildPseudoPages(plainText);
    const trimmed = await trimPaperTail(plainText, pages, aiConfig);
    mainText = trimmed.mainText;
    if (trimmed.tailTrim.applied) {
      log(
        "trim-paper-tail",
        `Trimmed paper tail from page ${trimmed.tailTrim.cutFromPage || "unknown"} with confidence ${trimmed.tailTrim.confidence ?? 0}`,
      );
    }
  } catch (error) {
    logWarn("trim-paper-tail", "Tail trim failed, using full text", error);
  }

  log(
    "extract-text",
    `Extracted ${plainText.length} chars via=mineru, kept ${mainText.length} chars for downstream processing`,
  );

  return {
    pageCount: result.totalPages ?? null,
    rawText: plainText,
    text: mainText,
    pdfMetadataTitle: title ?? undefined,
    contentPersisted: true,
  };
}

/** pdfjs 回退提取（原 Step 2 主体）。 */
async function extractViaPdfjs(
  pdfBuffer: ArrayBuffer,
  aiConfig: AIConfig,
  msg: QueueMessage,
  env: Env,
  log: LogFn,
): Promise<ExtractionOutcome> {
  try {
    log(
      "extract-text",
      `Extracting text from PDF (${pdfBuffer.byteLength} bytes) via=pdfjs-fallback`,
    );
    const result = await extractPDFText(pdfBuffer, 150, aiConfig); // 限制 150 页
    log(
      "extract-text",
      `Extracted ${result.rawText.length} chars from ${result.pageCount} pages via=pdfjs-fallback, kept ${result.mainText.length} chars for downstream processing`,
    );

    if (result.tailTrim.applied) {
      log(
        "trim-paper-tail",
        `Trimmed paper tail from page ${result.tailTrim.cutFromPage || "unknown"} with confidence ${result.tailTrim.confidence ?? 0}`,
      );
    }

    if (!result.mainText || result.mainText.trim().length === 0) {
      throw new Error("Extracted text is empty");
    }

    return {
      pageCount: result.pageCount,
      rawText: result.rawText,
      text: result.mainText,
      pdfMetadataTitle: result.title,
      contentPersisted: false,
    };
  } catch (error) {
    // 如果是页数超限错误，标记失败（扣过费才返还 credit）
    if (error instanceof PDFPageLimitError) {
      const errorMsg = `PDF has ${error.pageCount} pages, exceeding the limit of ${error.maxPages} pages`;
      log("extract-text", `Page limit exceeded: ${errorMsg}`);
      await markPaperFailedForMessage(msg.paperId, msg, errorMsg, env);
      throw new StepError("extract-text", error);
    }
    throw new StepError("extract-text", error);
  }
}

/**
 * 处理白板图片重新生成
 */
async function processWhiteboardRegeneration(
  msg: QueueMessage,
  env: Env,
): Promise<void> {
  const db = drizzle(env.DB);
  const startTime = Date.now();
  const log = (step: string, message: string) =>
    console.log(`[whiteboard:${msg.paperId}][${step}] ${message}`);
  const logWarn = (step: string, message: string, error?: unknown) =>
    console.warn(
      `[whiteboard:${msg.paperId}][${step}] ${message}`,
      error ?? "",
    );

  // Step 0: Mark whiteboard as regenerating
  try {
    await db
      .update(papers)
      .set({
        whiteboardRegenerating: true,
        updatedAt: new Date(),
      })
      .where(eq(papers.id, msg.paperId));
    log("status", "Marked whiteboard as regenerating");
  } catch (error) {
    logWarn("status", "Failed to mark whiteboard as regenerating", error);
  }

  // Step 1: 读取 AI 配置（用户配置或系统配置）
  let aiConfig: AIConfig;
  const usingUserApi = !!msg.apiConfigId;

  if (msg.apiConfigId) {
    try {
      log("load-config", `Loading user API configuration: ${msg.apiConfigId}`);

      // 从数据库读取用户配置
      const [config] = await db
        .select()
        .from(userApiConfigs)
        .where(
          and(
            eq(userApiConfigs.id, msg.apiConfigId),
            eq(userApiConfigs.userId, msg.userId),
          ),
        )
        .limit(1);

      if (!config) {
        throw new UserApiConfigError(
          `User API configuration not found: ${msg.apiConfigId}`,
        );
      }

      // 解密 API keys
      const secret = env.API_KEY_ENCRYPTION_SECRET;
      if (!secret) {
        throw new Error("API_KEY_ENCRYPTION_SECRET is not configured");
      }

      aiConfig = {
        openaiApiKey: await decrypt(config.openaiApiKey, secret),
        openaiBaseUrl: config.openaiBaseUrl,
        openaiModel: config.openaiModel,
        geminiApiKey: await decrypt(config.geminiApiKey, secret),
        geminiBaseUrl: config.geminiBaseUrl,
        geminiModel: config.geminiModel,
      };

      log("load-config", `User API configuration loaded successfully`);
    } catch (error) {
      if (error instanceof UserApiConfigError) {
        throw error;
      }
      throw new UserApiConfigError(
        `Failed to load user API configuration: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    // 使用系统配置
    log("load-config", "Using system API configuration");
    aiConfig = {
      openaiApiKey: env.OPENAI_API_KEY,
      openaiBaseUrl: env.OPENAI_BASE_URL,
      openaiModel: env.OPENAI_MODEL,
      geminiApiKey: env.GEMINI_API_KEY,
      geminiBaseUrl: env.GEMINI_BASE_URL,
      geminiModel: env.GEMINI_MODEL,
      cfApiToken: env.CF_API_TOKEN,
    };
  }

  // Step 1: 获取论文结果（用于获取 insights）
  let whiteboardInsights: string;
  try {
    log("load-results", `Loading paper results for paper ${msg.paperId}`);

    const [result] = await db
      .select()
      .from(paperResults)
      .where(eq(paperResults.paperId, msg.paperId))
      .limit(1);

    if (!result) {
      throw new Error(`Paper results not found for paper ${msg.paperId}`);
    }
    if (!result.whiteboardInsights) {
      // whiteboardInsights 可空后：未生成过 whiteboard 的论文没有基底可供 regenerate。
      throw new Error(
        `No whiteboard insights to regenerate for paper ${msg.paperId}`,
      );
    }

    whiteboardInsights = result.whiteboardInsights;
    log(
      "load-results",
      `Loaded whiteboard insights (${whiteboardInsights.length} chars)`,
    );
  } catch (error) {
    throw new StepError("load-results", error);
  }

  // Step 2: 读取自定义 Prompt 模板（如果提供）
  let customPromptTemplate: string | undefined;

  if (msg.promptId) {
    try {
      log("load-prompt", `Loading custom prompt template: ${msg.promptId}`);

      const [promptConfig] = await db
        .select()
        .from(whiteboardPrompts)
        .where(
          and(
            eq(whiteboardPrompts.id, msg.promptId),
            eq(whiteboardPrompts.userId, msg.userId),
          ),
        )
        .limit(1);

      if (!promptConfig) {
        logWarn(
          "load-prompt",
          `Custom prompt template not found: ${msg.promptId}, using default`,
        );
      } else {
        customPromptTemplate = promptConfig.promptTemplate;
        log("load-prompt", `Custom prompt template loaded successfully`);
      }
    } catch (error) {
      logWarn(
        "load-prompt",
        `Failed to load custom prompt template, using default`,
        error,
      );
    }
  }

  // Step 3: 生成白板图片
  let imageData: ArrayBuffer;
  try {
    log(
      "generate-image",
      `Generating whiteboard image (model: ${aiConfig.geminiModel || "default"}, baseUrl: ${aiConfig.geminiBaseUrl || "default"})`,
    );
    const whiteboardLang = msg.whiteboardLanguage || "en";
    const result = await generateWhiteboardImage(
      whiteboardInsights,
      "", // 不需要完整文本
      aiConfig,
      whiteboardLang,
      undefined, // 不需要摘要降级
      customPromptTemplate,
    );
    imageData = result.imageData;
    log("generate-image", `Image generated: ${imageData.byteLength} bytes`);
  } catch (error) {
    // 如果使用系统 API 失败，需要退还 credit
    if (!usingUserApi) {
      try {
        await refundCredit(
          msg.paperId,
          msg.userId,
          "Whiteboard regeneration failed",
          env,
        );
      } catch (refundError) {
        logWarn("refund", "Failed to refund credit", refundError);
      }
    }
    // Mark whiteboard regeneration as complete (failed)
    try {
      await db
        .update(papers)
        .set({
          whiteboardRegenerating: false,
          updatedAt: new Date(),
        })
        .where(eq(papers.id, msg.paperId));
    } catch (statusError) {
      logWarn("status", "Failed to clear regenerating status", statusError);
    }
    throw new StepError("generate-image", error);
  }

  // Step 4: 上传图片到 R2
  const imageR2Key = `whiteboards/${msg.paperId}/${crypto.randomUUID()}.png`;
  try {
    log("upload-image", `Uploading image to R2: ${imageR2Key}`);
    await env.PAPERS_BUCKET.put(imageR2Key, imageData, {
      httpMetadata: { contentType: "image/png" },
    });
    log("upload-image", `Image uploaded successfully`);
  } catch (error) {
    // 上传失败也需要退还 credit（如果使用系统 API）
    if (!usingUserApi) {
      try {
        await refundCredit(msg.paperId, msg.userId, "Image upload failed", env);
      } catch (refundError) {
        logWarn("refund", "Failed to refund credit", refundError);
      }
    }
    // Mark whiteboard regeneration as complete (failed)
    try {
      await db
        .update(papers)
        .set({
          whiteboardRegenerating: false,
          updatedAt: new Date(),
        })
        .where(eq(papers.id, msg.paperId));
    } catch (statusError) {
      logWarn("status", "Failed to clear regenerating status", statusError);
    }
    throw new StepError("upload-image", error);
  }

  // Step 5: 更新数据库（设置所有现有白板为非默认，插入新白板为默认）
  try {
    log("update-db", "Setting existing whiteboards to non-default");

    // 先设置所有现有白板为非默认
    await db
      .update(whiteboardImages)
      .set({ isDefault: false })
      .where(eq(whiteboardImages.paperId, msg.paperId));

    // 插入新白板记录为默认
    log("update-db", "Inserting new whiteboard as default");
    await db.insert(whiteboardImages).values({
      paperId: msg.paperId,
      imageR2Key: imageR2Key,
      promptId: msg.promptId || null,
      isDefault: true,
    });

    log("update-db", "Database updated successfully");
  } catch (error) {
    // 数据库更新失败也需要退还 credit（如果使用系统 API）
    if (!usingUserApi) {
      try {
        await refundCredit(
          msg.paperId,
          msg.userId,
          "Database update failed",
          env,
        );
      } catch (refundError) {
        logWarn("refund", "Failed to refund credit", refundError);
      }
    }
    // Mark whiteboard regeneration as complete (failed)
    try {
      await db
        .update(papers)
        .set({
          whiteboardRegenerating: false,
          updatedAt: new Date(),
        })
        .where(eq(papers.id, msg.paperId));
    } catch (statusError) {
      logWarn("status", "Failed to clear regenerating status", statusError);
    }
    throw new StepError("update-db", error);
  }

  // Step 6: Mark whiteboard regeneration as complete (success)
  try {
    await db
      .update(papers)
      .set({
        whiteboardRegenerating: false,
        updatedAt: new Date(),
      })
      .where(eq(papers.id, msg.paperId));
    log("status", "Marked whiteboard regeneration as complete");
  } catch (error) {
    logWarn("status", "Failed to clear regenerating status", error);
  }

  const processingTimeMs = Date.now() - startTime;
  log("done", `Whiteboard regeneration completed in ${processingTimeMs}ms`);
}

/**
 * 带步骤标识的错误，用于在最终错误消息中标明失败的步骤
 */
class StepError extends Error {
  readonly step: string;
  readonly cause: unknown;

  constructor(step: string, cause: unknown) {
    const causeMessage =
      cause instanceof Error ? cause.message : String(cause || "Unknown error");
    super(`[${step}] ${causeMessage}`);
    this.step = step;
    this.cause = cause;
  }
}

/**
 * 用户 API 配置错误，不应退还 credit
 */
class UserApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserApiConfigError";
  }
}

/**
 * 格式化错误详情，包含 step 信息和 cause 链
 */
function formatErrorDetail(error: unknown): string {
  if (error instanceof StepError) {
    return `Step "${error.step}" failed: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || "Unknown error");
}

async function updatePaperStatus(
  paperId: string,
  status: PaperStatus,
  errorMessage: string | null,
  env: Env,
): Promise<void> {
  const db = drizzle(env.DB);
  await db
    .update(papers)
    .set({
      status,
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(papers.id, paperId));
}

/**
 * 标记论文失败（不退还 credit）
 * 用于用户 API 配置错误等不应退还 credit 的情况
 */
async function markPaperFailed(
  paperId: string,
  errorMessage: string,
  env: Env,
): Promise<void> {
  // 截断过长的错误信息
  const truncated =
    errorMessage.length > 1000
      ? `${errorMessage.substring(0, 997)}...`
      : errorMessage;

  console.log(`[paper:${paperId}] Marking as failed (no refund): ${truncated}`);

  // 标记论文失败
  await updatePaperStatus(paperId, "failed", truncated, env);
}

/**
 * 标记论文失败并返还 credit
 */
async function markPaperFailedAndRefund(
  paperId: string,
  userId: string,
  errorMessage: string,
  env: Env,
): Promise<void> {
  const db = drizzle(env.DB);

  // 截断过长的错误信息
  const truncated =
    errorMessage.length > 1000
      ? `${errorMessage.substring(0, 997)}...`
      : errorMessage;

  console.log(
    `[paper:${paperId}] Marking as failed and refunding credit to user ${userId}`,
  );

  // 标记论文失败
  await updatePaperStatus(paperId, "failed", truncated, env);

  // 返还 1 credit
  await db
    .update(user)
    .set({
      credits: sql`${user.credits} + 1`,
    })
    .where(eq(user.id, userId));

  // 记录 credit 交易
  await db.insert(creditTransactions).values({
    userId: userId,
    amount: 1,
    type: "refund",
    relatedPaperId: paperId,
    description: `Refund for failed paper processing: ${truncated}`,
  });

  console.log(`[paper:${paperId}] Credit refunded successfully`);
}

/**
 * 标记失败；仅当这条消息实际扣过费（勾选 whiteboard 且未用 BYOK）才退款。
 * regenerate_whiteboard 的退款仍走原有独立路径，不经此函数。
 */
async function markPaperFailedForMessage(
  paperId: string,
  msg: QueueMessage,
  errorMessage: string,
  env: Env,
): Promise<void> {
  const charged = msg.generateWhiteboard === true && !msg.apiConfigId;
  if (charged) {
    await markPaperFailedAndRefund(paperId, msg.userId, errorMessage, env);
  } else {
    await markPaperFailed(paperId, errorMessage, env);
  }
}

/**
 * 退还 credit（用于白板重新生成失败）
 */
async function refundCredit(
  paperId: string,
  userId: string,
  reason: string,
  env: Env,
): Promise<void> {
  const db = drizzle(env.DB);

  console.log(
    `[paper:${paperId}] Refunding credit to user ${userId} for: ${reason}`,
  );

  // 返还 1 credit
  await db
    .update(user)
    .set({
      credits: sql`${user.credits} + 1`,
    })
    .where(eq(user.id, userId));

  // 记录 credit 交易
  await db.insert(creditTransactions).values({
    userId: userId,
    amount: 1,
    type: "refund",
    relatedPaperId: paperId,
    description: `Refund for whiteboard regeneration: ${reason}`,
  });

  console.log(`[paper:${paperId}] Credit refunded successfully`);
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");

  // 用户 API 配置错误不可重试
  if (error instanceof UserApiConfigError) {
    return false;
  }

  // 页数超限错误不可重试
  if (error instanceof StepError && error.cause instanceof PDFPageLimitError) {
    return false;
  }

  // 网络超时
  if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
    return true;
  }

  // API 限流
  if (message.includes("429") || message.includes("rate limit")) {
    return true;
  }

  // 临时服务错误 (5xx)
  if (
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  ) {
    return true;
  }

  return false;
}
