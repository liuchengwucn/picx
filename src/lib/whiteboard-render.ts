import { PhotonImage, watermark } from "@cf-wasm/photon";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { WATERMARK_PNG } from "#/assets/watermark-png";
import { papers, whiteboardImages } from "#/db/schema";
import { watermarkPosition } from "#/lib/watermark";

/** 渲染白板图所需的运行时绑定（image 路由与 tweet cron 共用）。 */
export interface WhiteboardRenderBindings {
  DB: D1Database;
  PAPERS_BUCKET: R2Bucket;
}

/** 用 Photon 在 PNG 右下角叠半透明 picx.dev 水印，返回新的 PNG 字节。 */
export function applyWatermark(pngBytes: Uint8Array): Uint8Array {
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

/**
 * 渲染指定 paper 的带水印默认白板图：D1 查询 → R2 取原图 → Photon 加水印。
 * paper 不存在 / 非公开 / 已删除 / 无默认白板 / R2 缺对象 时返回 null。
 *
 * 抽成共享函数后，image 路由与 tweet-poster-cron 都内联调用，cron 不再
 * 通过公网 fetch 自己的 zone（worker→同一 worker 的回环易触发 522 超时）。
 */
export async function renderWhiteboardImage(
  shortId: string,
  env: WhiteboardRenderBindings,
): Promise<Uint8Array | null> {
  const db = drizzle(env.DB);

  const [paper] = await db
    .select({ id: papers.id })
    .from(papers)
    .where(
      and(
        eq(papers.shortId, shortId),
        eq(papers.isPublic, true),
        isNull(papers.deletedAt),
      ),
    )
    .limit(1);
  if (!paper) return null;

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
  if (!wb?.key) return null;

  const object = await env.PAPERS_BUCKET.get(wb.key);
  if (!object) return null;

  const inputBytes = new Uint8Array(await object.arrayBuffer());
  return applyWatermark(inputBytes);
}
