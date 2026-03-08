import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "#/db/schema";
import { papers } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  getReviewGuestServerSession,
  isReviewGuestModeEnabled,
} from "#/lib/review-guest";

const POLL_INTERVAL_MS = 3000;

async function handler({ request }: { request: Request }) {
  const db = drizzle((env as typeof env & { DB: D1Database }).DB, { schema });
  const session =
    (await auth.api.getSession({ headers: request.headers })) ??
    (isReviewGuestModeEnabled() ? await getReviewGuestServerSession(db) : null);

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  writer.write(encoder.encode('data: {"type":"connected"}\n\n'));

  const knownStatuses = new Map<string, string>();
  const abortController = new AbortController();
  (async () => {
    try {
      while (!abortController.signal.aborted) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (abortController.signal.aborted) break;

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

        const trackingIds = [...knownStatuses.keys()];
        let trackedPapers: { id: string; status: string }[] = [];
        if (trackingIds.length > 0) {
          trackedPapers = await db
            .select({ id: papers.id, status: papers.status })
            .from(papers)
            .where(inArray(papers.id, trackingIds));
        }

        const allPapers = new Map<string, string>();
        for (const paper of [...activePapers, ...trackedPapers]) {
          allPapers.set(paper.id, paper.status);
        }

        for (const [paperId, status] of allPapers) {
          const known = knownStatuses.get(paperId);
          if (known !== status) {
            knownStatuses.set(paperId, status);
            if (
              known !== undefined ||
              activePapers.some((paper) => paper.id === paperId)
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
                return;
              }
            }
          }

          if (status === "completed" || status === "failed") {
            knownStatuses.delete(paperId);
          }
        }
      }
    } catch {
      // Stream closed or error, just exit
    }
  })();

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
