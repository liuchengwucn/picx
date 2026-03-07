import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { papers } from "#/db/schema";
import { auth } from "#/lib/auth";

const POLL_INTERVAL_MS = 3000;

async function handler({ request }: { request: Request }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const db = drizzle((env as typeof env & { DB: D1Database }).DB);
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // Send initial connected message
  writer.write(encoder.encode('data: {"type":"connected"}\n\n'));

  // Track known statuses to detect changes
  const knownStatuses = new Map<string, string>();

  // Poll for status changes in background
  const abortController = new AbortController();
  (async () => {
    try {
      while (!abortController.signal.aborted) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (abortController.signal.aborted) break;

        // Query active papers (non-terminal statuses)
        const activePapers = await db
          .select({ id: papers.id, status: papers.status })
          .from(papers)
          .where(
            and(
              eq(papers.userId, userId),
              inArray(papers.status, [
                "pending",
                "processing_text",
                "processing_image",
              ]),
            ),
          );

        // Also check recently completed/failed ones we were tracking
        const trackingIds = [...knownStatuses.keys()];
        let trackedPapers: { id: string; status: string }[] = [];
        if (trackingIds.length > 0) {
          trackedPapers = await db
            .select({ id: papers.id, status: papers.status })
            .from(papers)
            .where(inArray(papers.id, trackingIds));
        }

        const allPapers = new Map<string, string>();
        for (const p of [...activePapers, ...trackedPapers]) {
          allPapers.set(p.id, p.status);
        }

        for (const [paperId, status] of allPapers) {
          const known = knownStatuses.get(paperId);
          if (known !== status) {
            knownStatuses.set(paperId, status);
            // Only send if we had a previous known status (skip first discovery)
            // OR if it's from activePapers (always notify active ones on first seen)
            if (
              known !== undefined ||
              activePapers.some((p) => p.id === paperId)
            ) {
              const progress =
                status === "processing_text"
                  ? 33
                  : status === "processing_image"
                    ? 66
                    : status === "completed"
                      ? 100
                      : 0;
              const msg = `event: paper-update\ndata: ${JSON.stringify({ paperId, status, progress })}\n\n`;
              try {
                await writer.write(encoder.encode(msg));
              } catch {
                return; // Connection closed
              }
            }
          }

          // Stop tracking terminal statuses
          if (status === "completed" || status === "failed") {
            knownStatuses.delete(paperId);
          }
        }
      }
    } catch {
      // Stream closed or error, just exit
    }
  })();

  // Clean up when the request is aborted (client disconnects)
  request.signal.addEventListener("abort", () => {
    abortController.abort();
    writer.close().catch(() => {});
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export const Route = createFileRoute("/api/sse/connect")({
  server: {
    handlers: {
      GET: handler,
    },
  },
});
