import { z } from "zod";
import { protectedProcedure, router } from "../init";

export const sseRouter = router({
	/**
	 * Connect to SSE stream for real-time paper status updates
	 * Returns a Response with text/event-stream content type
	 */
	connect: protectedProcedure.query(async ({ ctx }) => {
		// Get Durable Object ID based on user ID
		const doId = ctx.env.PAPER_STATUS_DO.idFromName(ctx.session.user.id);
		const stub = ctx.env.PAPER_STATUS_DO.get(doId);

		// Forward the connection request to the Durable Object
		return stub.fetch(new Request("https://do/connect"));
	}),

	/**
	 * Send a notification to all connected clients for a specific user
	 * Used by the queue consumer to push status updates
	 */
	notify: protectedProcedure
		.input(
			z.object({
				paperId: z.string().uuid(),
				status: z.enum([
					"pending",
					"processing_text",
					"processing_image",
					"completed",
					"failed",
				]),
				progress: z.number().min(0).max(100).optional(),
				errorMessage: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Get Durable Object ID based on user ID
			const doId = ctx.env.PAPER_STATUS_DO.idFromName(ctx.session.user.id);
			const stub = ctx.env.PAPER_STATUS_DO.get(doId);

			// Send notification to the Durable Object
			await stub.fetch(
				new Request("https://do/notify", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						paperId: input.paperId,
						status: input.status,
						progress: input.progress,
						errorMessage: input.errorMessage,
					}),
				}),
			);

			return { success: true };
		}),
});
