import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";
import { protectedProcedure, router } from "../init";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

function estimateDecodedByteLength(base64: string) {
  const normalized = base64.trim();
  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;

  return Math.floor((normalized.length * 3) / 4) - padding;
}

function isPdfBuffer(buffer: Uint8Array) {
  return PDF_SIGNATURE.every((byte, index) => buffer[index] === byte);
}

export const uploadRouter = router({
  /**
   * Upload PDF file via server relay to R2
   */
  uploadFile: protectedProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(255),
        fileData: z.string(), // base64 encoded
        fileSize: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
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
        const estimatedSize = estimateDecodedByteLength(input.fileData);
        if (estimatedSize > MAX_UPLOAD_BYTES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Uploaded file exceeds the 50MB limit",
          });
        }

        const buffer = Uint8Array.from(atob(input.fileData), (c) =>
          c.charCodeAt(0),
        );

        if (buffer.byteLength !== input.fileSize) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Declared file size does not match uploaded data",
          });
        }

        if (buffer.byteLength > MAX_UPLOAD_BYTES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Uploaded file exceeds the 50MB limit",
          });
        }

        if (!isPdfBuffer(buffer)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Uploaded file is not a valid PDF",
          });
        }

        await ctx.env.PAPERS_BUCKET.put(r2Key, buffer, {
          httpMetadata: { contentType: "application/pdf" },
        });

        return { r2Key };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        console.error("Failed to upload file to R2:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to upload file",
          cause: error,
        });
      }
    }),
});
