import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTRPC } from "#/integrations/trpc/react";

interface PaperStatusEvent {
  paperId: string;
  status: string;
  progress?: number;
  errorMessage?: string;
}

interface WhiteboardUpdateEvent {
  paperId: string;
  regenerating: boolean;
}

export function usePaperSSE(userId: string | undefined) {
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;

    function connect() {
      // Clean up any existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const es = new EventSource("/api/sse/connect");
      eventSourceRef.current = es;

      es.addEventListener("paper-update", (event) => {
        try {
          const data: PaperStatusEvent = JSON.parse(event.data);
          queryClient.invalidateQueries({
            queryKey: trpc.paper.list.queryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: trpc.paper.getById.queryKey(data.paperId),
          });
          if (data.status === "completed" || data.status === "failed") {
            queryClient.invalidateQueries({
              queryKey: trpc.user.getProfile.queryKey(),
            });
          }
        } catch (e) {
          console.error("SSE parse error:", e);
        }
      });

      es.addEventListener("whiteboard-update", (event) => {
        try {
          const data: WhiteboardUpdateEvent = JSON.parse(event.data);
          queryClient.invalidateQueries({
            queryKey: trpc.paper.getById.queryKey(data.paperId),
          });
          queryClient.invalidateQueries({
            queryKey: trpc.paper.listWhiteboards.queryKey(data.paperId),
          });
          // If regeneration completed, also refresh user profile (credits might have changed)
          if (!data.regenerating) {
            queryClient.invalidateQueries({
              queryKey: trpc.user.getProfile.queryKey(),
            });
          }
        } catch (e) {
          console.error("SSE whiteboard-update parse error:", e);
        }
      });

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        // Reconnect after 3 seconds
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };
    }

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [userId, queryClient, trpc]);
}
