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
  const knownWhiteboardRegenerating = new Map<string, boolean>();
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

        // Also track papers with whiteboard regenerating
        const regeneratingPapers = await db
          .select({
            id: papers.id,
            status: papers.status,
            whiteboardRegenerating: papers.whiteboardRegenerating,
          })
          .from(papers)
          .where(
            and(
              eq(papers.userId, userId),
              eq(papers.whiteboardRegenerating, true),
            ),
          );

        const trackingIds = [...knownStatuses.keys()];
        const trackingWhiteboardIds = [...knownWhiteboardRegenerating.keys()];
        let trackedPapers: {
          id: string;
          status: string;
          whiteboardRegenerating: boolean;
        }[] = [];
        if (trackingIds.length > 0 || trackingWhiteboardIds.length > 0) {
          const allTrackingIds = [
            ...new Set([...trackingIds, ...trackingWhiteboardIds]),
          ];
          trackedPapers = await db
            .select({
              id: papers.id,
              status: papers.status,
              whiteboardRegenerating: papers.whiteboardRegenerating,
            })
            .from(papers)
            .where(inArray(papers.id, allTrackingIds));
        }

        const allPapers = new Map<
          string,
          { status: string; whiteboardRegenerating: boolean }
        >();
        for (const paper of [
          ...activePapers.map((p) => ({
            ...p,
            whiteboardRegenerating: false,
          })),
          ...regeneratingPapers,
          ...trackedPapers,
        ]) {
          allPapers.set(paper.id, {
            status: paper.status,
            whiteboardRegenerating: paper.whiteboardRegenerating ?? false,
          });
        }

        for (const [paperId, paperData] of allPapers) {
          const { status, whiteboardRegenerating } = paperData;

          // Check status changes
          const knownStatus = knownStatuses.get(paperId);
          if (knownStatus !== status) {
            knownStatuses.set(paperId, status);
            if (
              knownStatus !== undefined ||
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

          // Check whiteboard regenerating changes
          const knownRegenerating =
            knownWhiteboardRegenerating.get(paperId) ?? false;
          if (knownRegenerating !== whiteboardRegenerating) {
            knownWhiteboardRegenerating.set(paperId, whiteboardRegenerating);
            if (
              knownRegenerating !== undefined ||
              regeneratingPapers.some((paper) => paper.id === paperId)
            ) {
              const msg = `event: whiteboard-update\ndata: ${JSON.stringify({ paperId, regenerating: whiteboardRegenerating })}\n\n`;
              try {
                await writer.write(encoder.encode(msg));
              } catch {
                return;
              }
            }
          }

          // Clean up tracking
          if (status === "completed" || status === "failed") {
            knownStatuses.delete(paperId);
          }
          if (!whiteboardRegenerating) {
            knownWhiteboardRegenerating.delete(paperId);
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
