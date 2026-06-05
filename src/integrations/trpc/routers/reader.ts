import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getBatchResult } from "#/lib/mineru";
import { renderZip } from "#/lib/reader-render";
import { protectedProcedure, router } from "../init";

function requireToken(token: string | undefined): string {
  if (!token) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "MINERU_TOKEN not configured",
    });
  }
  return token;
}

export const readerRouter = router({
  /**
   * 查询解析批次状态。
   */
  getStatus: protectedProcedure
    .input(z.object({ batchId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const token = requireToken(ctx.env.MINERU_TOKEN);

      try {
        const r = await getBatchResult(token, input.batchId);
        return { state: r.state, errMsg: r.errMsg ?? null };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        console.error("Failed to query MinerU status:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to query status",
          cause: error,
        });
      }
    }),

  /**
   * 取解析结果，下载 zip 并渲染为内联 markdown。
   */
  getResult: protectedProcedure
    .input(z.object({ batchId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const token = requireToken(ctx.env.MINERU_TOKEN);

      try {
        const r = await getBatchResult(token, input.batchId);

        if (r.state !== "done" || !r.fullZipUrl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Result not ready",
          });
        }

        const resp = await fetch(r.fullZipUrl);
        if (!resp.ok) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to download result archive",
          });
        }

        const bytes = new Uint8Array(await resp.arrayBuffer());
        const { title, markdown } = renderZip(bytes);

        return { title: title ?? r.fileName ?? "Untitled", markdown };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        console.error("Failed to fetch MinerU result:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch result",
          cause: error,
        });
      }
    }),
});
