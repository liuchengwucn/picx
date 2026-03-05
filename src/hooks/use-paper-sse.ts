import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTRPC } from "#/integrations/trpc/react";

interface PaperStatusEvent {
  paperId: string;
  status: string;
  progress?: number;
  errorMessage?: string;
}

export function usePaperSSE(userId: string | undefined) {
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!userId) return;

    const url = `/api/trpc/sse.connect`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data: PaperStatusEvent = JSON.parse(event.data);
        // Invalidate paper queries to trigger refetch
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
    };

    es.onerror = () => {
      es.close();
      // Reconnect after 3 seconds
      setTimeout(() => {
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
      }, 3000);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [userId, queryClient, trpc]);
}
