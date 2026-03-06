import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { paperResults, papers } from "#/db/schema";
import type { AIConfig } from "#/lib/ai";
import {
  extractPaperTitle,
  generateMindmapImage,
  generateMindmapStructure,
  generateSummary,
} from "#/lib/ai";
import { downloadArxivPDF, extractPDFText } from "#/lib/pdf";

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
}

interface Env {
  DB: D1Database;
  PAPERS_BUCKET: R2Bucket;
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  GEMINI_API_KEY: string;
  GEMINI_BASE_URL?: string;
  GEMINI_MODEL?: string;
  CF_API_TOKEN?: string;
}

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processPaper(message.body, env);
        message.ack();
      } catch (error) {
        console.error(
          `Failed to process paper ${message.body.paperId}:`,
          error,
        );

        // 判断是否可重试
        if (isRetryableError(error)) {
          message.retry();
        } else {
          // 标记为 failed
          await markPaperFailed(
            message.body.paperId,
            error instanceof Error ? error.message : "Unknown error",
            env,
          );
          message.ack();
        }
      }
    }
  },
};

async function processPaper(msg: QueueMessage, env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const startTime = Date.now();

  // Step 1: 获取 PDF
  let pdfBuffer: ArrayBuffer;
  let r2Key = msg.r2Key;

  if (msg.sourceType === "arxiv") {
    // 下载 arXiv PDF
    pdfBuffer = await downloadArxivPDF(msg.arxivUrl!);

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
    // 从 R2 读取上传的 PDF
    const object = await env.PAPERS_BUCKET.get(r2Key!);
    if (!object) {
      throw new Error("PDF file not found in R2");
    }
    pdfBuffer = await object.arrayBuffer();
  }

  // Step 2: 提取文本
  await updatePaperStatus(msg.paperId, "processing_text", null, env);
  const { pageCount, text, title: pdfMetadataTitle } = await extractPDFText(pdfBuffer);

  if (!text || text.trim().length === 0) {
    throw new Error("Failed to extract text from PDF");
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

  let paperTitle: string;
  if (pdfMetadataTitle) {
    // 如果PDF元数据中有标题，直接使用
    paperTitle = pdfMetadataTitle;
  } else {
    // 否则使用LLM从文本中提取标题（使用前3000字符）
    const textForTitleExtraction = text.substring(0, 3000);
    try {
      paperTitle = await extractPaperTitle(textForTitleExtraction, aiConfig);
    } catch (error) {
      console.warn("Failed to extract title with LLM, using fallback:", error);
      // 如果LLM提取失败，使用原始文件名
      paperTitle = msg.sourceType === "arxiv"
        ? `arXiv Paper ${msg.paperId.substring(0, 8)}`
        : (msg.arxivUrl?.split("/").pop() || `Paper ${msg.paperId.substring(0, 8)}`);
    }
  }

  // 更新标题和页数
  await db
    .update(papers)
    .set({
      title: paperTitle,
      pageCount
    })
    .where(eq(papers.id, msg.paperId));

  // Step 4: 生成总结和思维导图结构

  // Step 4: 生成总结和思维导图结构
  // TODO: 从用户配置获取语言偏好，目前默认使用英文
  const language: "en" | "zh" = "en";

  const summary = await generateSummary(text, aiConfig, language);
  const mindmapMarkdown = await generateMindmapStructure(summary, aiConfig);

  // Step 5: 生成思维导图图片
  await updatePaperStatus(msg.paperId, "processing_image", null, env);
  const { imageData, prompt } = await generateMindmapImage(
    mindmapMarkdown,
    aiConfig,
  );

  // 上传图片到 R2
  const imageR2Key = `mindmaps/${msg.userId}/${msg.paperId}.png`;
  await env.PAPERS_BUCKET.put(imageR2Key, imageData, {
    httpMetadata: { contentType: "image/png" },
  });

  // Step 6: 保存结果
  const processingTimeMs = Date.now() - startTime;
  await db.insert(paperResults).values({
    paperId: msg.paperId,
    summaries: { [language]: summary }, // 使用 JSON 结构存储
    summaryLanguage: language,
    mindmapStructure: mindmapMarkdown,
    mindmapImageR2Key: imageR2Key,
    imagePrompt: prompt,
    processingTimeMs,
  });

  // Step 7: 标记完成
  await updatePaperStatus(msg.paperId, "completed", null, env);
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

async function markPaperFailed(
  paperId: string,
  errorMessage: string,
  env: Env,
): Promise<void> {
  await updatePaperStatus(paperId, "failed", errorMessage, env);
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");

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
