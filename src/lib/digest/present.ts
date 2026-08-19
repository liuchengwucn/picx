/**
 * 简报的「四语存储 → 单语视图」映射。
 *
 * 单独一个模块而不是留在 tRPC router 里, 是因为简报期页 /gallery/d/$slug/$issue 的
 * SSR loader 必须直读 D1(SSR 侧 tRPC client 指向 localhost, 部署到 Workers 里发不
 * 出去), 于是 loader 与 procedure 都要做同一次 pickTldr。而 router 模块静态 import
 * 了 trpc init(里面有 `cloudflare:workers`), 路由文件一旦静态引它客户端就打不出包。
 * 这里只依赖 pickTldr 与两个 type-only 的 IssueDetail / EditionDetail(均来自
 * store 层而非 router), 两侧都能直接 import。
 */
import type { EditionDetail } from "#/lib/digest/edition-store";
import type { IssueDetail } from "#/lib/digest/store";
import { pickTldr } from "#/lib/tldr";

export const LOCALE_KEYS = ["en", "zh-cn", "zh-tw", "ja"] as const;
export type LocaleKey = (typeof LOCALE_KEYS)[number];

/** 从简报 markdown 正文抽首段纯文本做摘要（跳过标题行/空行，截 160 字符） */
export function excerptFromMarkdown(md: string | null | undefined): string {
  if (!md) return "";
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    // 剥完标记（引用号/强调符）可能留下首尾空白，再 trim 一次
    const plain = t
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`>]/g, "")
      .trim();
    if (plain) return plain.length > 160 ? `${plain.slice(0, 160)}…` : plain;
  }
  return "";
}

/**
 * head 专用的四语短摘要: head() 在客户端会随 locale 重算, 但 loaderData 被冻结在
 * SSR 那次的 locale, 所以要把每个语言的首段摘要都展开带给 head 自己挑。逐语言先抽
 * 短文本, 避免把四份完整 markdown 塞进 loaderData(会进 dehydrate payload 打到客户端)。
 * 每个 key 的回退顺序走 pickTldr, 与 mapIssueToLocale 同口径。
 */
export function excerptByLocale(
  content: Record<string, string> | null,
): Record<LocaleKey, string> {
  return Object.fromEntries(
    LOCALE_KEYS.map((k) => [k, excerptFromMarkdown(pickTldr(content, k))]),
  ) as Record<LocaleKey, string>;
}

/** intro 未生成时把单语中文 focusBrief 伪装成四语对象；intro 全量回填后整个函数删掉即可 */
export function directionIntroSource(row: {
  intro: Record<string, string> | null;
  focusBrief: string;
}): Record<string, string> {
  return row.intro ?? { "zh-cn": row.focusBrief };
}

/**
 * 一期简报的公开单语视图。字段集就是对外契约 —— digest.getIssue 的输出与期页
 * SSR loader 注入 react-query 的 initialData 必须逐字同构, 增删字段前先看
 * digest.test.ts 里那条 key 集断言。
 */
export function mapIssueToLocale(issue: IssueDetail, localeKey: LocaleKey) {
  return {
    directionSlug: issue.directionSlug,
    directionName:
      pickTldr(issue.directionName, localeKey) ?? issue.directionSlug,
    issueNumber: issue.issueNumber,
    title: pickTldr(issue.title, localeKey) ?? "",
    content: pickTldr(issue.content, localeKey) ?? "",
    periodStart: issue.periodStart,
    periodEnd: issue.periodEnd,
    publishedAt: issue.publishedAt,
    papers: issue.papers.map((p) => ({
      id: p.id,
      shortId: p.shortId,
      title: p.title,
      tldr: pickTldr(p.tldr, localeKey) ?? "",
      whiteboardImageR2Key: p.whiteboardImageR2Key,
      recommendationNote: pickTldr(p.recommendationNote, localeKey) ?? "",
      rank: p.rank,
      likeCount: p.likeCount,
    })),
    prevIssue: issue.prevIssue,
    nextIssue: issue.nextIssue,
  };
}

/**
 * 合刊的公开单语视图。/gallery 与 /gallery/w/$period 的 SSR loader 直读 D1 后走
 * 同一个映射(与期页同理: SSR 侧 tRPC client 指向 localhost 发不出去), 所以两条
 * 路径下发的形状必须逐字一致。
 *
 * content 刻意不出现在返回值里: 只抽 excerpt。EditionSection.content 是四语
 * markdown 全文, 七个栏目的正文全文若原样下发会让首屏 dehydrate payload 翻倍;
 * 正文全文的唯一去处是单期页(mapIssueToLocale)。返回类型天然不含 content ——
 * 这是故意让 tsc 而不是人来守住这条不变式, 别为了「方便」把 content 透传出去。
 */
export function mapEditionToLocale(
  edition: EditionDetail,
  localeKey: LocaleKey,
) {
  return {
    period: edition.period,
    periodStart: edition.periodStart,
    periodEnd: edition.periodEnd,
    publishedAt: edition.publishedAt,
    isLatest: edition.isLatest,
    prevPeriod: edition.prevPeriod,
    nextPeriod: edition.nextPeriod,
    activeDirectionCount: edition.activeDirectionCount,
    sections: edition.sections.map((s) => ({
      directionSlug: s.directionSlug,
      directionName: pickTldr(s.directionName, localeKey) ?? s.directionSlug,
      directionCreatedAt: s.directionCreatedAt,
      issueNumber: s.issueNumber,
      title: pickTldr(s.title, localeKey) ?? "",
      excerpt: excerptFromMarkdown(pickTldr(s.content, localeKey)),
      pickCount: s.pickCount,
      picks: s.picks.map((p) => ({
        id: p.id,
        shortId: p.shortId,
        title: p.title,
        recommendationNote: pickTldr(p.recommendationNote, localeKey) ?? "",
        whiteboardImageR2Key: p.whiteboardImageR2Key,
        rank: p.rank,
      })),
    })),
  };
}

export type EditionView = ReturnType<typeof mapEditionToLocale>;
