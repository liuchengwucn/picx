import { PhotonImage, watermark } from "@cf-wasm/photon";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { WATERMARK_PNG } from "#/assets/watermark-png";
import { watermarkPosition } from "#/lib/watermark";

interface AppEnvBindings {
  DB: D1Database;
  PAPERS_BUCKET: R2Bucket;
}

/** 用 Photon 在 PNG 右下角叠半透明 picx.dev 水印，返回新的 PNG 字节。 */
function applyWatermark(pngBytes: Uint8Array): Uint8Array {
  const base = PhotonImage.new_from_byteslice(pngBytes);
  const mark = PhotonImage.new_from_byteslice(WATERMARK_PNG);
  try {
    const { x, y } = watermarkPosition(
      base.get_width(),
      base.get_height(),
      mark.get_width(),
      mark.get_height(),
    );
    watermark(base, mark, BigInt(x), BigInt(y));
    return base.get_bytes();
  } finally {
    base.free();
    mark.free();
  }
}

async function handler({
  request,
  params,
}: {
  request: Request;
  params: { shortId: string };
}) {
  try {
    const { drizzle } = await import("drizzle-orm/d1");
    const { and, eq, isNull } = await import("drizzle-orm");
    const { papers, whiteboardImages } = await import("#/db/schema");

    const appEnv = env as typeof env & AppEnvBindings;
    const db = drizzle(appEnv.DB);

    const [paper] = await db
      .select({ id: papers.id })
      .from(papers)
      .where(
        and(
          eq(papers.shortId, params.shortId),
          eq(papers.isPublic, true),
          isNull(papers.deletedAt),
        ),
      )
      .limit(1);
    if (!paper) return new Response("Not found", { status: 404 });

    const [wb] = await db
      .select({ key: whiteboardImages.imageR2Key })
      .from(whiteboardImages)
      .where(
        and(
          eq(whiteboardImages.paperId, paper.id),
          eq(whiteboardImages.isDefault, true),
        ),
      )
      .limit(1);
    if (!wb?.key) return new Response("Not found", { status: 404 });

    const object = await appEnv.PAPERS_BUCKET.get(wb.key);
    if (!object) return new Response("Not found", { status: 404 });

    const inputBytes = new Uint8Array(await object.arrayBuffer());
    const outBytes = applyWatermark(inputBytes);

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
