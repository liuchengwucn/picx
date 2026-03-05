import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { papers, paperResults } from "#/db/schema";
import { extractPDFText, downloadArxivPDF } from "#/lib/pdf";
import {
	generateSummary,
	generateMindmapStructure,
	generateMindmapImage,
} from "#/lib/ai";
import type { AIConfig } from "#/lib/ai";

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
	PAPER_STATUS_DO: DurableObjectNamespace;
}

/**
 * Send SSE notification to user about paper processing status
 * @param env - Worker environment bindings
 * @param userId - User ID to send notification to
 * @param paperId - Paper ID being processed
 * @param status - Current processing status
 * @param progress - Processing progress (0-100)
 * @param errorMessage - Optional error message for failed status
 */
async function notifySSE(
	env: Env,
	userId: string,
	paperId: string,
	status: PaperStatus,
	progress: number,
	errorMessage: string | null = null,
): Promise<void> {
	try {
		const doId = env.PAPER_STATUS_DO.idFromName(userId);
		const stub = env.PAPER_STATUS_DO.get(doId);

		await stub.fetch(
			new Request("https://do/notify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					paperId,
					status,
					progress,
					errorMessage,
				}),
			}),
		);
	} catch (error) {
		console.error(
			`Failed to notify SSE for user ${userId}, paper ${paperId}:`,
			error,
		);
	}
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
						message.body.userId,
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

		// 更新数据库中的 r2Key
		await db
			.update(papers)
			.set({ pdfR2Key: r2Key })
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
	await notifySSE(env, msg.userId, msg.paperId, "processing_text", 33);
	const { pageCount, text } = await extractPDFText(pdfBuffer);

	if (!text || text.trim().length === 0) {
		throw new Error("Failed to extract text from PDF");
	}

	// 更新页数
	await db.update(papers).set({ pageCount }).where(eq(papers.id, msg.paperId));

	// Step 3: 生成总结和思维导图结构
	const aiConfig: AIConfig = {
		openaiApiKey: env.OPENAI_API_KEY,
		openaiBaseUrl: env.OPENAI_BASE_URL,
		openaiModel: env.OPENAI_MODEL,
		geminiApiKey: env.GEMINI_API_KEY,
		geminiBaseUrl: env.GEMINI_BASE_URL,
		geminiModel: env.GEMINI_MODEL,
	};

	const summary = await generateSummary(text, aiConfig);
	const mindmapStructure = await generateMindmapStructure(summary, aiConfig);

	// Step 4: 生成思维导图图片
	await updatePaperStatus(msg.paperId, "processing_image", null, env);
	await notifySSE(env, msg.userId, msg.paperId, "processing_image", 66);
	const { imageData, prompt } = await generateMindmapImage(
		mindmapStructure,
		aiConfig,
	);

	// 上传图片到 R2
	const imageR2Key = `mindmaps/${msg.userId}/${msg.paperId}.png`;
	await env.PAPERS_BUCKET.put(imageR2Key, imageData, {
		httpMetadata: { contentType: "image/png" },
	});

	// Step 5: 保存结果
	const processingTimeMs = Date.now() - startTime;
	await db.insert(paperResults).values({
		paperId: msg.paperId,
		summary,
		mindmapStructure: JSON.stringify(mindmapStructure),
		mindmapImageR2Key: imageR2Key,
		imagePrompt: prompt,
		processingTimeMs,
	});

	// Step 6: 标记完成
	await updatePaperStatus(msg.paperId, "completed", null, env);
	await notifySSE(env, msg.userId, msg.paperId, "completed", 100);
}

/**
 * Update paper status in database
 * @param paperId - Paper ID to update
 * @param status - New status
 * @param errorMessage - Error message if status is failed
 * @param env - Worker environment bindings
 */
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
 * Mark paper as failed and notify user via SSE
 * @param userId - User ID who owns the paper
 * @param paperId - Paper ID to mark as failed
 * @param errorMessage - Error message describing the failure
 * @param env - Worker environment bindings
 */
async function markPaperFailed(
	userId: string,
	paperId: string,
	errorMessage: string,
	env: Env,
): Promise<void> {
	await updatePaperStatus(paperId, "failed", errorMessage, env);
	await notifySSE(env, userId, paperId, "failed", 0, errorMessage);
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
