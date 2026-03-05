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
		await updatePaperStatus(msg.paperId, "processing_text", null, env);
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
	const text = await extractPDFText(pdfBuffer);

	if (!text || text.trim().length === 0) {
		throw new Error("Failed to extract text from PDF");
	}

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
	const mindmapStructure = await generateMindmapStructure(text, aiConfig);

	// Step 4: 生成思维导图图片
	await updatePaperStatus(msg.paperId, "processing_image", null, env);
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

	// Step 7: 通知 Durable Object 推送 SSE 更新
	await notifyPaperUpdate(msg.paperId, "completed", env);
}

async function updatePaperStatus(
	paperId: string,
	status: string,
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

	// 通知 Durable Object 推送状态更新
	await notifyPaperUpdate(paperId, status, env, errorMessage);
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

async function notifyPaperUpdate(
	paperId: string,
	status: string,
	env: Env,
	errorMessage?: string | null,
): Promise<void> {
	try {
		// 获取 Durable Object 实例
		const id = env.PAPER_STATUS_DO.idFromName(paperId);
		const stub = env.PAPER_STATUS_DO.get(id);

		// 发送通知
		await stub.fetch("https://fake-host/notify", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				paperId,
				status,
				errorMessage,
			}),
		});
	} catch (error) {
		// SSE 通知失败不应该影响主流程
		console.error("Failed to notify paper update:", error);
	}
}
