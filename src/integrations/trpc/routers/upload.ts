import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";
import { protectedProcedure, router } from "../init";

export const uploadRouter = router({
  /**
   * Upload PDF file via server relay to R2
   */
  uploadFile: protectedProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(255),
        fileData: z.string(), // base64 encoded
        fileSize: z
          .number()
          .int()
          .min(1)
          .max(50 * 1024 * 1024), // 50MB
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (isReviewGuestReadOnlySession(ctx.session)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Review guest mode is read-only",
        });
      }

      const timestamp = Date.now();
      const r2Key = `papers/${ctx.session.user.id}/${timestamp}-${input.filename}`;

      try {
        const buffer = Uint8Array.from(atob(input.fileData), (c) =>
          c.charCodeAt(0),
        );

        await ctx.env.PAPERS_BUCKET.put(r2Key, buffer, {
          httpMetadata: { contentType: "application/pdf" },
        });

        return { r2Key };
      } catch (error) {
        console.error("Failed to upload file to R2:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to upload file",
          cause: error,
        });
      }
    }),
});
