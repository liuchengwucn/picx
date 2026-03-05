import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { generatePresignedUploadUrl } from "#/lib/r2";
import { protectedProcedure, router } from "../init";

export const uploadRouter = router({
	/**
	 * Get presigned upload URL for PDF file
	 * Client can upload directly to R2 using this URL
	 */
	getPresignedUrl: protectedProcedure
		.input(
			z.object({
				filename: z.string().min(1).max(255),
				contentType: z.string(),
				fileSize: z
					.number()
					.int()
					.min(1)
					.max(50 * 1024 * 1024), // 50MB
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// 验证文件类型
			if (input.contentType !== "application/pdf") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Only PDF files are allowed",
				});
			}

			// 生成唯一的 R2 key
			const timestamp = Date.now();
			const r2Key = `papers/${ctx.session.user.id}/${timestamp}-${input.filename}`;

			try {
				// 从环境变量获取 R2 配置
				const accountId = process.env.R2_ACCOUNT_ID;
				const accessKeyId = process.env.R2_ACCESS_KEY_ID;
				const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

				if (!accountId || !accessKeyId || !secretAccessKey) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "R2 credentials not configured",
					});
				}

				// 生成预签名 URL
				const uploadUrl = await generatePresignedUploadUrl(
					accountId,
					accessKeyId,
					secretAccessKey,
					"picx-papers",
					r2Key,
					3600, // 1 hour
				);

				return {
					uploadUrl,
					r2Key,
					expiresIn: 3600,
				};
			} catch (error) {
				console.error("Failed to generate presigned URL:", error);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to generate upload URL",
					cause: error,
				});
			}
		}),
});
