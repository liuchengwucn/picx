// src/lib/digest/retranslate.ts
//
// 存量简报的单语言重译（运维入口 /__ops/retranslate-digest 调用）。
//
// 2026-08-29 那批 ja 泄漏是在 translateDigest 加出口校验之前产生的，只能事后
// 按期回填。重译一律以 zh-cn 为源、只覆盖目标语言那一个键，其余语言原样保留。
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { digestPapers, digests, directions } from "#/db/schema";
import { translateDigest } from "./ai";
import { cheapModel, type DigestModelEnv } from "./llm";
import type { TranslationTarget } from "./translation-guard";

type Db = ReturnType<typeof drizzle>;

export interface RetranslateResult {
  digestId: string;
  slug: string;
  issueNumber: number;
  status: "ok" | "skipped" | "failed";
  /** 实际写回的字段数（title/content 各算 1，推荐语按条算） */
  written: number;
  detail?: string;
}

/**
 * 把 `slug#issue`（也接受 `slug:issue`）或裸 digest id 解析成 digest id。
 * 运维手里通常只有「formal-math 第 3 期」这种坐标，逼人先去查 UUID 没有意义。
 */
export async function resolveDigestRef(
  db: Db,
  ref: string,
): Promise<string | null> {
  const match = ref.match(/^(.+?)[#:](\d+)$/);
  if (!match) return ref.trim() || null;
  const [, slug, issue] = match;
  const [row] = await db
    .select({ id: digests.id })
    .from(digests)
    .innerJoin(directions, eq(directions.id, digests.directionId))
    .where(
      and(
        eq(directions.slug, slug.trim()),
        eq(digests.issueNumber, Number(issue)),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * 重译一期的单个目标语言并写回。
 *
 * D1 无事务：title/content 一条 update、每条推荐语各一条 update，中途失败会留下
 * 部分写入的一期。这是可接受的——重译幂等（源始终是 zh-cn），重跑即可补齐。
 */
export async function retranslateDigestLocale(
  db: Db,
  env: DigestModelEnv,
  digestId: string,
  target: TranslationTarget,
  options: { dryRun?: boolean } = {},
): Promise<RetranslateResult> {
  const [row] = await db
    .select({
      id: digests.id,
      issueNumber: digests.issueNumber,
      title: digests.title,
      content: digests.content,
      slug: directions.slug,
    })
    .from(digests)
    .innerJoin(directions, eq(directions.id, digests.directionId))
    .where(eq(digests.id, digestId))
    .limit(1);
  if (!row) {
    return {
      digestId,
      slug: "?",
      issueNumber: 0,
      status: "failed",
      written: 0,
      detail: "digest not found",
    };
  }
  const base = {
    digestId,
    slug: row.slug,
    issueNumber: row.issueNumber,
  } as const;

  const sourceTitle = row.title?.["zh-cn"] ?? "";
  const sourceContent = row.content?.["zh-cn"] ?? "";
  if (!sourceTitle || !sourceContent) {
    return {
      ...base,
      status: "skipped",
      written: 0,
      detail: "no zh-cn source to translate from",
    };
  }

  const paperRows = await db
    .select({
      paperId: digestPapers.paperId,
      note: digestPapers.recommendationNote,
    })
    .from(digestPapers)
    .where(eq(digestPapers.digestId, digestId));

  // 推荐语以 paperId 为 key 送进模型：key 对模型是不透明标识（prompt 明确
  // "translate values only, never keys"），写回时按同一个 key 找回行。
  const notes: Record<string, string> = {};
  for (const p of paperRows) {
    const zh = p.note?.["zh-cn"];
    if (zh) notes[p.paperId] = zh;
  }

  const translated = await translateDigest(cheapModel(env), target, {
    title: sourceTitle,
    content: sourceContent,
    notes,
  });

  if (options.dryRun) {
    return {
      ...base,
      status: "ok",
      written: 0,
      detail: `dry run: title=${translated.title.slice(0, 40)}… notes=${Object.keys(translated.notes).length}/${Object.keys(notes).length}`,
    };
  }

  await db
    .update(digests)
    .set({
      title: { ...(row.title ?? {}), [target]: translated.title },
      content: { ...(row.content ?? {}), [target]: translated.content },
      updatedAt: new Date(),
    })
    .where(eq(digests.id, digestId));
  let written = 2;

  let missing = 0;
  for (const p of paperRows) {
    if (!notes[p.paperId]) continue;
    const value = translated.notes[p.paperId];
    // 模型漏掉某条 key 时保留原值：宁可留着旧 ja 也不要写进空串
    if (!value) {
      missing++;
      continue;
    }
    await db
      .update(digestPapers)
      .set({ recommendationNote: { ...(p.note ?? {}), [target]: value } })
      .where(
        and(
          eq(digestPapers.digestId, digestId),
          eq(digestPapers.paperId, p.paperId),
        ),
      );
    written++;
  }

  return {
    ...base,
    status: "ok",
    written,
    detail:
      missing > 0
        ? `${missing} note(s) missing in output, kept old`
        : undefined,
  };
}
