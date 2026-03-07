import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { creditTransactions, paperResults, papers, user } from "#/db/schema";
import type { AIConfig } from "#/lib/ai";
import {
  extractPaperTitle,
  generateSummary,
  generateWhiteboardImage,
  generateWhiteboardStructure,
} from "#/lib/ai";
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
  let text: string;
  let pdfMetadataTitle: string | undefined;

  try {
    log(
      "extract-text",
      `Extracting text from PDF (${pdfBuffer.byteLength} bytes)`,
    );
    const result = await extractPDFText(pdfBuffer, 150); // 限制 150 页
    pageCount = result.pageCount;
    text = result.text;
    pdfMetadataTitle = result.title;
    log(
      "extract-text",
      `Extracted ${text.length} chars from ${pageCount} pages`,
    );

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
  const aiConfig: AIConfig = {
    openaiApiKey: env.OPENAI_API_KEY,
    openaiBaseUrl: env.OPENAI_BASE_URL,
    openaiModel: env.OPENAI_MODEL,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiBaseUrl: env.GEMINI_BASE_URL,
    geminiModel: env.GEMINI_MODEL,
    cfApiToken: env.CF_API_TOKEN,
  };

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
    const textForTitleExtraction = text.substring(0, 3000);

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

  // Step 4: 生成总结和白板结构
  const language: "en" | "zh-cn" | "zh-tw" | "ja" = msg.language || "en";

  let summary: string;
  let whiteboardMarkdown: string;
  try {
    log(
      "generate-summary",
      `Generating summary (text: ${text.length} chars, lang: ${language}, model: ${aiConfig.openaiModel || "default"}, baseUrl: ${aiConfig.openaiBaseUrl || "default"})`,
    );
    summary = await generateSummary(text, aiConfig, language);
    log("generate-summary", `Summary generated: ${summary.length} chars`);
  } catch (error) {
    throw new StepError("generate-summary", error);
  }

  try {
    log("generate-whiteboard", "Generating whiteboard structure");
    whiteboardMarkdown = await generateWhiteboardStructure(text, aiConfig);
    log(
      "generate-whiteboard",
      `Whiteboard structure generated: ${whiteboardMarkdown.length} chars`,
    );
  } catch (error) {
    throw new StepError("generate-whiteboard", error);
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
      whiteboardMarkdown,
      text,
      aiConfig,
      whiteboardLang,
      summary, // 传递摘要作为降级选项
    );
    imageData = result.imageData;
    prompt = result.prompt;
    log("generate-image", `Image generated: ${imageData.byteLength} bytes`);
  } catch (error) {
    throw new StepError("generate-image", error);
  }

  // 上传图片到 R2
  const imageR2Key = `whiteboards/${msg.userId}/${msg.paperId}.png`;
  await env.PAPERS_BUCKET.put(imageR2Key, imageData, {
    httpMetadata: { contentType: "image/png" },
  });

  // Step 6: 保存结果
  const processingTimeMs = Date.now() - startTime;
  await db.insert(paperResults).values({
    paperId: msg.paperId,
    summaries: { [language]: summary },
    summaryLanguage: language,
    whiteboardStructure: whiteboardMarkdown,
    whiteboardImageR2Key: imageR2Key,
    imagePrompt: prompt,
    processingTimeMs,
  });

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
