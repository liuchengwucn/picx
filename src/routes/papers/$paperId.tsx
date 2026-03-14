import { createFileRoute, Navigate, redirect } from "@tanstack/react-router";
import { isRedirect } from "@tanstack/router-core";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#/integrations/trpc/react";

interface AppEnvBindings {
  DB: D1Database;
}

export const Route = createFileRoute("/papers/$paperId")({
  component: PaperRedirect,
  loader: async ({ params }) => {
    if (import.meta.env.SSR) {
      try {
        const { env } = await import("cloudflare:workers");
        const { drizzle } = await import("drizzle-orm/d1");
        const { eq } = await import("drizzle-orm");
        const { papers } = await import("#/db/schema");
        const appEnv = env as typeof env & AppEnvBindings;
        const db = drizzle(appEnv.DB);

        const [row] = await db
          .select({ shortId: papers.shortId })
          .from(papers)
          .where(eq(papers.id, params.paperId))
          .limit(1);

        if (row?.shortId) {
          throw redirect({
            to: "/p/$shortId",
            params: { shortId: row.shortId },
            statusCode: 301,
          });
        }
      } catch (e) {
        if (isRedirect(e)) throw e;
      }
    }
    return {};
  },
});

function PaperRedirect() {
  const { paperId } = Route.useParams();
  const trpc = useTRPC();

  const { data } = useQuery(trpc.paper.getById.queryOptions(paperId));

  if (data?.paper?.shortId) {
    return (
      <Navigate
        to="/p/$shortId"
        params={{ shortId: data.paper.shortId }}
        replace
      />
    );
  }

  return null;
}
