import { tool } from "ai";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import type * as schema from "#/db/schema";
import { papers } from "#/db/schema";
import {
  canonicalArxivId,
  canonicalArxivUrl,
  HF_DAILY_PAPERS_API,
} from "#/lib/arxiv";

type Db = DrizzleD1Database<typeof schema>;

/** 发现类工具的数值上限（从 AGENT_LIMITS 移入，数值不变） */
export const DISCOVERY_LIMITS = {
  /** 外部 API（arXiv / HF）单次最多返回条数 */
  externalMaxResults: 15,
  /** 工具返回的摘要截断长度：控制上下文占用 */
  abstractChars: 800,
} as const;

/**
 * 落库时保留 output 的卡片工具 part 类型：历史回显要重建卡片。
 * 搜索工具的 output 落库时照常剥掉。/api/chat 与 /api/agent 共用。
 */
export const CARD_TOOL_TYPES: ReadonlySet<string> = new Set([
  "tool-recommendPapers",
]);

// ---------- 外部结果的公共形状（前端卡片按这个渲染，别改字段名） ----------

export interface DiscoveredPaper {
  arxivId: string;
  /** canonical https://arxiv.org/abs/{id} */
  url: string;
  title: string;
  authors: string[];
  published: string;
  abstract: string;
  categories?: string[];
  upvotes?: number;
  inLibrary: boolean;
  /** 已在库中时给出站内 shortId，卡片可链到 /p/{shortId} */
  libraryShortId?: string;
}

/** arXiv Atom XML → 结构化条目。Workers 无 DOMParser，用正则逐 entry 提取（纯函数，可测） */
export function parseArxivAtom(
  xml: string,
): Omit<DiscoveredPaper, "inLibrary" | "libraryShortId">[] {
  const unescapeXml = (s: string) =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  const text = (block: string, tag: string) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return m ? unescapeXml(m[1].replace(/\s+/g, " ").trim()) : "";
  };
  const entries: Omit<DiscoveredPaper, "inLibrary" | "libraryShortId">[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = m[1];
    const rawId = text(block, "id"); // 形如 http://arxiv.org/abs/2601.13209v2
    const arxivId = canonicalArxivId(rawId);
    if (!arxivId) continue;
    const authors = [...block.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((a) =>
      unescapeXml(a[1].trim()),
    );
    const categories = [...block.matchAll(/<category[^>]*term="([^"]+)"/g)].map(
      (c) => c[1],
    );
    entries.push({
      arxivId,
      url: `https://arxiv.org/abs/${arxivId}`,
      title: text(block, "title"),
      authors,
      published: text(block, "published").slice(0, 10),
      abstract: text(block, "summary").slice(0, DISCOVERY_LIMITS.abstractChars),
      categories,
    });
  }
  return entries;
}

/** 给外部结果打 inLibrary 标：owned 为「canonical sourceUrl → shortId」映射（纯函数，可测） */
export function markInLibrary(
  entries: Omit<DiscoveredPaper, "inLibrary" | "libraryShortId">[],
  owned: Map<string, string>,
): DiscoveredPaper[] {
  return entries.map((e) => {
    const shortId = owned.get(e.url);
    return shortId
      ? { ...e, inLibrary: true, libraryShortId: shortId }
      : { ...e, inLibrary: false };
  });
}

/** recommendPapers 输入清洗：canonical 化（去版本号等）、滤掉无效 id、去重（纯函数，可测） */
export function normalizeArxivIds(ids: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = canonicalArxivId(raw);
    if (id) seen.add(id);
  }
  return [...seen];
}

/** 查用户库，构造 canonical sourceUrl → shortId 映射（urls ≤20，远低于 D1 参数上限） */
async function loadOwnedUrlMap(
  db: Db,
  userId: string,
  urls: string[],
): Promise<Map<string, string>> {
  if (urls.length === 0) return new Map();
  const rows = await db
    .select({ sourceUrl: papers.sourceUrl, shortId: papers.shortId })
    .from(papers)
    .where(
      and(
        eq(papers.userId, userId),
        isNull(papers.deletedAt),
        inArray(papers.sourceUrl, urls),
      ),
    );
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.sourceUrl) map.set(r.sourceUrl, r.shortId);
  }
  return map;
}

export interface DiscoveryToolsDeps {
  db: Db;
  userId: string;
}

/**
 * 发现+推荐工具集：searchArxiv / listDailyPapers / recommendPapers。
 * 论文页 chatbot 与 assistant agent 共用；调用方 spread 进自己的工具集。
 */
export function buildDiscoveryTools({ db, userId }: DiscoveryToolsDeps) {
  return {
    searchArxiv: tool({
      description:
        "Search arXiv for papers by keyword. Optional category filter (e.g. cs.CL) and sort order. Results are visible only to you; use recommendPapers to show selected papers to the user. The query is matched as a phrase; keep it short (2-5 words) and issue multiple searches for different angles.",
      inputSchema: z.object({
        query: z.string().min(1).max(200),
        category: z.string().max(20).optional(),
        sortBy: z
          .enum(["relevance", "submittedDate", "lastUpdatedDate"])
          .default("relevance"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(DISCOVERY_LIMITS.externalMaxResults)
          .default(8),
      }),
      execute: async ({ query, category, sortBy, maxResults }) => {
        // arXiv API 的 all:"..." 是短语语法：手工套双引号即可，" 和 \ 会破坏查询语法所以先清掉
        const cleaned = query
          .replace(/["\\]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!cleaned) return { error: "empty query" };
        // 白名单校验后才拼进 search_query 字符串：category 直接嵌入未加引号，
        // 放行奇怪字符（如空格/AND/OR）等于让模型注入额外布尔子句，不匹配就当未提供处理
        const safeCategory =
          category && /^[a-z-]+(\.[A-Za-z-]+)?$/.test(category)
            ? category
            : undefined;
        const q = safeCategory
          ? `all:"${cleaned}" AND cat:${safeCategory}`
          : `all:"${cleaned}"`;
        const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&start=0&max_results=${maxResults}&sortBy=${sortBy}&sortOrder=descending`;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          if (!res.ok) return { error: `arXiv API returned ${res.status}` };
          const entries = parseArxivAtom(await res.text());
          const owned = await loadOwnedUrlMap(
            db,
            userId,
            entries.map((e) => e.url),
          );
          return { results: markInLibrary(entries, owned) };
        } catch (error) {
          console.error("[agent] searchArxiv failed:", error);
          return {
            error:
              "arXiv search failed (network or timeout); try again or use web search",
          };
        }
      },
    }),

    listDailyPapers: tool({
      description:
        "List trending papers from HuggingFace Daily Papers. Optional date (YYYY-MM-DD), defaults to the latest. Results are visible only to you; use recommendPapers to show selected papers to the user.",
      inputSchema: z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
      execute: async ({ date }) => {
        const url = date
          ? `${HF_DAILY_PAPERS_API}?date=${date}`
          : HF_DAILY_PAPERS_API;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          if (!res.ok)
            return { error: `HuggingFace API returned ${res.status}` };
          const data = (await res.json()) as {
            paper?: {
              id?: string;
              title?: string;
              summary?: string;
              upvotes?: number;
              authors?: { name?: string }[];
            };
            publishedAt?: string;
          }[];
          const entries = data
            .slice(0, DISCOVERY_LIMITS.externalMaxResults)
            .flatMap((item) => {
              const arxivId = item.paper?.id
                ? canonicalArxivId(item.paper.id)
                : null;
              if (!arxivId || !item.paper?.title) return [];
              return [
                {
                  arxivId,
                  url: canonicalArxivUrl(arxivId),
                  title: item.paper.title,
                  authors: (item.paper.authors ?? [])
                    .map((a) => a.name ?? "")
                    .filter(Boolean),
                  published: (item.publishedAt ?? "").slice(0, 10),
                  abstract: (item.paper.summary ?? "").slice(
                    0,
                    DISCOVERY_LIMITS.abstractChars,
                  ),
                  upvotes: item.paper.upvotes,
                },
              ];
            });
          const owned = await loadOwnedUrlMap(
            db,
            userId,
            entries.map((e) => e.url),
          );
          return { results: markInLibrary(entries, owned) };
        } catch (error) {
          console.error("[agent] listDailyPapers failed:", error);
          return {
            error:
              "HuggingFace Daily Papers request failed; try searchArxiv instead",
          };
        }
      },
    }),

    recommendPapers: tool({
      description:
        "Show selected papers to the user as cards with an add-to-library button, placed at this point in the conversation. This is the ONLY way the user can see paper cards — search results are never shown to them directly. Call it right where you discuss or recommend the papers, and only for papers worth the user's attention.",
      inputSchema: z.object({
        arxivIds: z.array(z.string().min(1).max(40)).min(1).max(8),
      }),
      execute: async ({ arxivIds }) => {
        const ids = normalizeArxivIds(arxivIds);
        if (ids.length === 0) return { error: "no valid arXiv ids" };
        const url = `https://export.arxiv.org/api/query?id_list=${ids.join(",")}&max_results=${ids.length}`;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          if (!res.ok) return { error: `arXiv API returned ${res.status}` };
          const entries = parseArxivAtom(await res.text());
          // id 格式合法但 arXiv 查无此文时返回空 feed（无错误条目）：必须显式提示，
          // 否则模型会以为卡片已经展示给用户了
          if (entries.length === 0)
            return {
              results: [],
              note: "no papers found for these ids; cards were NOT shown",
            };
          const owned = await loadOwnedUrlMap(
            db,
            userId,
            entries.map((e) => e.url),
          );
          return { results: markInLibrary(entries, owned) };
        } catch (error) {
          console.error("[agent] recommendPapers failed:", error);
          return { error: "arXiv lookup failed; retry recommendPapers" };
        }
      },
    }),
  };
}
