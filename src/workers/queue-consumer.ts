import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  creditTransactions,
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
import { downloadArxivPDF, extractPDFText, PDFPageLimitError } from "#/lib/pdf";
import type { Env } from "#/types/env";

type PaperStatus =
  | "pending"
  | "processing_text"
  | "processing_image"
  | "completed"
  | "failed";

// 队列消息契约统一在 #/integrations/trpc/init 的 PaperQueueMessage（生产端与消费端共用）

const MAX_RETRIES = 3;

// tldr 生成/翻译针对网关瞬时限流(429)/超时的重试次数。
// tldr 是「非关键步骤」(失败仅回退到 summary 兜底), 但每日 cron 批量入队时
// 这一步靠后的 4 连发最容易踩到限流, 故给较多次数 + 指数退避兜稳。
const TLDR_RETRIES = 5;

// 分类同样是「非关键步骤」(失败回退 ["other"]),但缺重试时一次瞬时
// API 抖动/截断就会把论文永久误分类成 other。给它和 tldr 同等的重试兜底。
const CLASSIFY_RETRIES = 3;

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

        // 最后一次重试也失败了，或者是不可重试的错误 → 标记 failed 并返还 credit
        if (attempt >= MAX_RETRIES || !isRetryableError(error)) {
          const reason =
            attempt >= MAX_RETRIES
              ? `Exhausted ${MAX_RETRIES} retries. Last error: ${errorDetail}`
              : errorDetail;
          await markPaperFailedAndRefund(
            paperId,
            message.body.userId,
            reason,
            env,
          );
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
  const [existingPaper] = await db
    .select({ status: papers.status })
    .from(papers)
    .where(eq(papers.id, msg.paperId))
    .limit(1);

  if (!existingPaper) {
    log("idempotency", "Paper not found, skipping");
    return;
  }

  if (existingPaper.status === "completed") {
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

  // Step 0.5: 读取自定义 Prompt 模板（如果提供）
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

  // Step 1: 获取 PDF
  let pdfBuffer: ArrayBuffer;
  let r2Key = msg.r2Key;

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

  // Step 2: 提取文本
  await updatePaperStatus(msg.paperId, "processing_text", null, env);
  let pageCount: number;
  let rawText: string;
  let text: string;
  let pdfMetadataTitle: string | undefined;

  try {
    log(
      "extract-text",
      `Extracting text from PDF (${pdfBuffer.byteLength} bytes)`,
    );
    const result = await extractPDFText(pdfBuffer, 150, aiConfig); // 限制 150 页
    pageCount = result.pageCount;
    rawText = result.rawText;
    text = result.mainText;
    pdfMetadataTitle = result.title;
    log(
      "extract-text",
      `Extracted ${rawText.length} chars from ${pageCount} pages, kept ${text.length} chars for downstream processing`,
    );

    if (result.tailTrim.applied) {
      log(
        "trim-paper-tail",
        `Trimmed paper tail from page ${result.tailTrim.cutFromPage || "unknown"} with confidence ${result.tailTrim.confidence ?? 0}`,
      );
    }

    if (!text || text.trim().length === 0) {
      throw new Error("Extracted text is empty");
    }
  } catch (error) {
    // 如果是页数超限错误，返还 credit 并标记失败
    if (error instanceof PDFPageLimitError) {
      const errorMsg = `PDF has ${error.pageCount} pages, exceeding the limit of ${error.maxPages} pages`;
      log("extract-text", `Page limit exceeded: ${errorMsg}`);
      await markPaperFailedAndRefund(msg.paperId, msg.userId, errorMsg, env);
      throw new StepError("extract-text", error);
    }
    throw new StepError("extract-text", error);
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

  // 更新标题和页数
  await db
    .update(papers)
    .set({
      title: paperTitle,
      pageCount,
    })
    .where(eq(papers.id, msg.paperId));

  // Step 4: 生成总结和白板洞察（并行执行）
  const language: "en" | "zh-cn" | "zh-tw" | "ja" = msg.language || "en";

  let summary: string;
  let whiteboardInsights: string;
  let classification: { categories: string[]; tags: string[] } = {
    categories: ["other"],
    tags: [],
  };
  try {
    log(
      "generate-summary-and-whiteboard",
      `Generating summary and whiteboard insights in parallel (text: ${text.length} chars, lang: ${language})`,
    );

    // 并行执行摘要生成和白板洞察生成
    [summary, whiteboardInsights, classification] = await Promise.all([
      generateSummary(text, aiConfig, language),
      generateWhiteboardInsights(text, aiConfig),
      // 分类失败不应中断整篇处理:重试兜稳瞬时抖动,重试耗尽才回退 ["other"]。
      withRetry(() => classifyPaper(text, aiConfig), {
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
      }),
    ]);

    log(
      "generate-summary-and-whiteboard",
      `Summary (${summary.length} chars) and whiteboard insights (${whiteboardInsights.length} chars) generated`,
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

  // Step 5: 生成白板图片
  await updatePaperStatus(msg.paperId, "processing_image", null, env);
  let imageData: ArrayBuffer;
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

  // Step 6: 上传图片到 R2 和保存结果到数据库（并行执行）
  const imageR2Key = `whiteboards/${msg.paperId}/${crypto.randomUUID()}.png`;
  const processingTimeMs = Date.now() - startTime;

  // 幂等清理: 顶部守卫已挡掉「已 completed 的重投」; 这里覆盖另一种情况——
  // 上一次处理写入 paper_results/白板后、标记 completed 前崩溃, 重试重跑到这里。
  // 此时 status 仍是 processing_*, 不会被守卫跳过, 若不先清理就会插出第二行。
  // 初始处理阶段论文刚创建, 不存在用户合法的多份结果, 直接清空既有结果再写。
  await db.delete(paperResults).where(eq(paperResults.paperId, msg.paperId));
  await db
    .delete(whiteboardImages)
    .where(eq(whiteboardImages.paperId, msg.paperId));

  await Promise.all([
    // 上传图片到 R2
    env.PAPERS_BUCKET.put(imageR2Key, imageData, {
      httpMetadata: { contentType: "image/png" },
    }),
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
    db
      .insert(whiteboardImages)
      .values({
        paperId: msg.paperId,
        imageR2Key: imageR2Key,
        promptId: msg.promptId || null,
        isDefault: true,
      }),
  ]);

  // Step 7: 标记完成
  await updatePaperStatus(msg.paperId, "completed", null, env);
  log("done", `Completed in ${processingTimeMs}ms`);
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
