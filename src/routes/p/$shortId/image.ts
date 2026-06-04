import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import {
  renderWhiteboardImage,
  type WhiteboardRenderBindings,
} from "#/lib/whiteboard-render";

async function handler({
  request,
  params,
}: {
  request: Request;
  params: { shortId: string };
}) {
  try {
    const appEnv = env as typeof env & WhiteboardRenderBindings;
    const outBytes = await renderWhiteboardImage(params.shortId, appEnv);
    if (!outBytes) return new Response("Not found", { status: 404 });

    const url = new URL(request.url);
    const headers: Record<string, string> = {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    };
    if (url.searchParams.has("download")) {
      headers["Content-Disposition"] = 'attachment; filename="whiteboard.png"';
    }

    return new Response(outBytes.buffer as ArrayBuffer, { headers });
  } catch (error) {
    console.error("Error building watermarked image:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

export const Route = createFileRoute("/p/$shortId/image")({
  server: {
    handlers: {
      GET: handler,
    },
  },
});
