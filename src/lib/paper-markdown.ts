import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { paperResults, papers, whiteboardImages } from "#/db/schema";
import { buildPaperMarkdown } from "#/lib/llm-markdown";
import { SITE_URL } from "#/lib/site-url";
import { normalizeLocaleKey } from "#/lib/tldr";

/**
 * 读取一篇公开论文并渲染成 Markdown 文档 (供 `/p/{id}.md` 与 Accept 协商使用)。
 * 论文不存在 / 非公开 / 已删除时返回 null, 由调用方决定 404 或回退。
 *
 * 路由层无法表达「参数段 + .md 字面扩展」, 故该逻辑放在 Worker 入口 (server.ts)
 * 拦截, 这里只负责取数与拼装。
 */
export async function loadPaperMarkdown(
  db: DrizzleD1Database,
  shortId: string,
  lang?: string | null,
): Promise<string | null> {
  const [paper] = await db
    .select()
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

  const [result] = await db
    .select()
    .from(paperResults)
    .where(eq(paperResults.paperId, paper.id))
    .limit(1);

  const [defaultWhiteboard] = await db
    .select({ imageR2Key: whiteboardImages.imageR2Key })
    .from(whiteboardImages)
    .where(
      and(
        eq(whiteboardImages.paperId, paper.id),
        eq(whiteboardImages.isDefault, true),
      ),
    )
    .limit(1);

  const langKey = normalizeLocaleKey(lang ?? "en");
  const summaries =
    (result?.summaries as Record<string, string> | null) ?? null;
  const tldrMap = (result?.tldr as Record<string, string> | null) ?? null;
  const summary = summaries
    ? (summaries[langKey] ??
      summaries.en ??
      Object.values(summaries)[0] ??
      null)
    : null;
  const tldr = tldrMap
    ? (tldrMap[langKey] ?? tldrMap.en ?? Object.values(tldrMap)[0] ?? null)
    : null;

  return buildPaperMarkdown({
    title: paper.title,
    shortId: paper.shortId ?? shortId,
    summary,
    tldr,
    sourceType: paper.sourceType,
    sourceUrl: paper.sourceUrl,
    publishedAt: paper.publishedAt,
    hasWhiteboard: Boolean(defaultWhiteboard?.imageR2Key),
    siteUrl: SITE_URL,
  });
}
