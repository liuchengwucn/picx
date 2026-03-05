import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../init";

export const uploadRouter = router({
	/**
	 * Get upload URL for PDF file
	 * Note: Since R2 presigned URLs are not implemented,
	 * this returns the r2Key for direct upload via API
	 */
	getUploadUrl: protectedProcedure
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

			// 注意：由于 R2 预签名 URL 未实现，
			// 这里返回 r2Key，客户端需要通过另一个 API 上传文件内容
			// 或者实现直接上传的 endpoint

			return {
				r2Key,
				uploadUrl: null, // 预签名 URL 未实现
				message: "Use the upload endpoint to upload file content",
			};
		}),
});
