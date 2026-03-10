import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  creditTransactions,
  paperResults,
  papers,
  user,
  userApiConfigs,
  whiteboardPrompts,
} from "#/db/schema";
import type { AIConfig } from "#/lib/ai";
import {
  extractPaperTitle,
  generateSummary,
  generateWhiteboardImage,
  generateWhiteboardInsights,
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

interface QueueMessage {
  paperId: string;
  userId: string;
  sourceType: "upload" | "arxiv";
  arxivUrl?: string;
  r2Key?: string;
  language?: "en" | "zh-cn" | "zh-tw" | "ja"; // 摘要语言
  whiteboardLanguage?: "en" | "zh-cn" | "zh-tw" | "ja"; // 白板图语言
  apiConfigId?: string; // 用户提供的 API 配置 ID
  promptId?: string; // 用户提供的 Prompt 模板 ID
}

const MAX_RETRIES = 3;

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const { paperId } = message.body;
      const attempt = message.attempts;

      try {
        console.log(
          `[paper:${paperId}] Processing attempt ${attempt}/${MAX_RETRIES}`,
        );
        await processPaper(message.body, env);
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
  try {
    log(
      "generate-summary-and-whiteboard",
      `Generating summary and whiteboard insights in parallel (text: ${text.length} chars, lang: ${language})`,
    );

    // 并行执行摘要生成和白板洞察生成
    [summary, whiteboardInsights] = await Promise.all([
      generateSummary(text, aiConfig, language),
      generateWhiteboardInsights(text, aiConfig),
    ]);

    log(
      "generate-summary-and-whiteboard",
      `Summary (${summary.length} chars) and whiteboard insights (${whiteboardInsights.length} chars) generated`,
    );
  } catch (error) {
    // 判断是哪个步骤失败了
    const stepName =
      error instanceof Error && error.message.includes("Summary")
        ? "generate-summary"
        : "generate-whiteboard";
    throw new StepError(stepName, error);
  }

  // Step 5: 生成白板图片
  await updatePaperStatus(msg.paperId, "processing_image", null, env);
  let imageData: ArrayBuffer;
  let prompt: string;
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
    prompt = result.prompt;
    log("generate-image", `Image generated: ${imageData.byteLength} bytes`);
  } catch (error) {
    throw new StepError("generate-image", error);
  }

  // Step 6: 上传图片到 R2 和保存结果到数据库（并行执行）
  const imageR2Key = `whiteboards/${msg.userId}/${msg.paperId}.png`;
  const processingTimeMs = Date.now() - startTime;

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
        summaries: { [language]: summary },
        summaryLanguage: language,
        whiteboardInsights: whiteboardInsights,
        whiteboardImageR2Key: imageR2Key,
        imagePrompt: prompt,
        processingTimeMs,
      }),
  ]);

  // Step 7: 标记完成
  await updatePaperStatus(msg.paperId, "completed", null, env);
  log("done", `Completed in ${processingTimeMs}ms`);
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
