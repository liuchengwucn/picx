/**
 * 简报的「四语存储 → 单语视图」映射。
 *
 * 单独一个模块而不是留在 tRPC router 里, 是因为简报期页 /gallery/d/$slug/$issue 的
 * SSR loader 必须直读 D1(SSR 侧 tRPC client 指向 localhost, 部署到 Workers 里发不
 * 出去), 于是 loader 与 procedure 都要做同一次 pickTldr。而 router 模块静态 import
 * 了 trpc init(里面有 `cloudflare:workers`), 路由文件一旦静态引它客户端就打不出包。
 * 这里只依赖 pickTldr 与一个 type-only 的 IssueDetail, 两侧都能直接 import。
 */
import type { IssueDetail } from "#/lib/digest/store";
import { pickTldr } from "#/lib/tldr";

type LocaleKey = "en" | "zh-cn" | "zh-tw" | "ja";

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
