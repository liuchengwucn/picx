import { type ToolUIPart, tool } from "ai";
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

/** 发现类工具的数值上限 */
export const DISCOVERY_LIMITS = {
  /** 外部 API（arXiv / HF）单次最多返回条数 */
  externalMaxResults: 15,
  /** 搜索类工具返回的摘要截断长度：这份是给模型读的，控制上下文占用 */
  abstractChars: 800,
  /**
   * recommendPapers 返回的摘要截断长度，比 abstractChars 短得多。
   * 不对称是故意的：只有它的 output 会随 CARD_TOOL_TYPES 落进 D1，而唯一的读者是
   * 卡片（line-clamp-2，肉眼约 120 字），历史重放只喂 text part 所以模型不会再读这份；
   * chat.getMessages 又是整会话不分页返回，多存的字符每次开会话都要搬一遍。
   */
  cardAbstractChars: 240,
  /**
   * 单次请求内所有发现类工具加起来最多打几次外部 API。拍的预算，不是推导出来的界：
   * 只要够一次正常的「多角度搜索 + recommendPapers 取详情」用不到即可。
   */
  externalCallBudget: 15,
} as const;

/**
 * 落库时保留 output 的卡片工具 part 类型：历史回显要重建卡片。
 * 搜索工具的 output 落库时照常剥掉。/api/chat 与 /api/agent 共用。
 */
export const CARD_TOOL_TYPES: ReadonlySet<string> = new Set([
  "tool-recommendPapers",
]);

/**
 * recommendPapers 的行为契约：卡片是用户看见论文的唯一途径，模型自己不能入库。
 * 两个 chatbot 的系统提示逐字复用同一条，避免各自抄一份后静默漂移。
 * 含开头的 "- " 项目符号：两端都是拼进 Rules 数组直接用，改这里的格式要同时看两处。
 */
export const DISCOVERY_PROMPT_RULE =
  "- Search results are visible only to you. To show papers to the user, call recommendPapers with their arXiv IDs — it renders cards with an add-to-library button at that point in the conversation. Weave these calls naturally into the flow of your reply, right where you discuss the papers (multiple calls per reply are fine); do not dump one big batch at the end, and do not recommend every search hit — curate. You cannot add papers to the library yourself; when the user wants to save one, tell them to click the add button on its card.";

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
    // 截前 10 位：大型合作组论文能列几百位作者，而卡片最多显示 3 位 + et al.。
    // recommendPapers 的 output 会连同作者名一起落进 D1（CARD_TOOL_TYPES 保留），
    // 且 getMessages 整会话不分页返回，不设上限等于把这几百个名字反复搬运。
    const authors = [...block.matchAll(/<name>([\s\S]*?)<\/name>/g)]
      .slice(0, 10)
      .map((a) => unescapeXml(a[1].trim()));
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

/** 回放摘要里单个标题的截断长度 */
const REPLAY_TITLE_CHARS = 120;

/**
 * 单条回放摘要最多折几篇。inputSchema 那边是 .max(8)，但落库的 output 不会在读出来
 * 时再验一遍（历史行是任意年代写下的），所以这里自己兜一道，别让一行脏数据把整个
 * 上下文撑爆。
 */
const MAX_REPLAY_PAPERS = 8;

/**
 * 卡片回放摘要：recommendPapers 的 output 会落进 D1 供前端刷新后重建卡片，但历史
 * 重放是 text-only 的——不折一行喂回去的话，用户指着屏幕上的卡片问「第二篇讲什么」
 * 时，模型的上下文里一篇都没有。
 *
 * 只带标题 + arXiv id + 是否已入库：摘要不带（8 篇 × 240 字每轮都要重放一遍），
 * 模型要细节可以拿 id 再查；inLibrary 顺手防住「推荐一篇用户已经加过的论文」。
 * output 是任意年代的 D1 JSON，逐字段做形状防御，取不到就跳过这一条。
 */
export function digestRecommendPapersForReplay(
  part: ToolUIPart,
): string | undefined {
  if (part.type !== "tool-recommendPapers") return undefined;
  const results = (part.output as { results?: unknown } | undefined)?.results;
  if (!Array.isArray(results)) return undefined;
  const lines = results.slice(0, MAX_REPLAY_PAPERS).flatMap((raw) => {
    const paper = raw as Partial<DiscoveredPaper> | null;
    if (
      typeof paper?.title !== "string" ||
      typeof paper?.arxivId !== "string"
    ) {
      return [];
    }
    // 标题是 arXiv 上的自由文本，而这行会以 assistant 身份进模型上下文（比 tool result
    // 更受信任）：方括号/引号/换行必须先掉，否则可以闭合注解后伪造角色行注入指令。
    // 顺序不能反——先剥再截，截断长度才仍然是上限
    const safeTitle = paper.title
      .replace(/[[\]"\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, REPLAY_TITLE_CHARS);
    const owned = paper.inLibrary ? " (already in the user's library)" : "";
    return [`"${safeTitle}" arXiv:${paper.arxivId}${owned}`];
  });
  if (lines.length === 0) return undefined;
  return `[Paper cards shown to the user at this point: ${lines.join("; ")}]`;
}

/**
 * 卡片工具在流式管线里的成对配置：output 落库（前端刷新后重建卡片）与回放摘要
 * （模型也得知道卡片存在）必须同进同退。两端 spread 同一个对象，杜绝只接一半。
 */
export const CARD_REPLAY_SPEC = {
  keepToolOutputTypes: CARD_TOOL_TYPES,
  replayToolDigest: digestRecommendPapersForReplay,
} as const;

/** 查用户库，构造 canonical sourceUrl → shortId 映射（urls ≤15，远低于 D1 参数上限） */
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
  // maxToolSteps 只限步数，不限每步并发发出的工具调用数：实测一次回复能发出 10 次
  // searchArxiv。arXiv 要求 ≤1 req/3s 且会封 IP，而 Workers 出口 IP 是共享的。
  // 本工厂每轮生成只构造一次（GENERATION_SPECS.buildTools，在 ChatRunner DO 里），
  // 所以闭包计数就是准的。
  let externalCalls = 0;
  /** 领一次外部请求配额；超预算返回 false。调用方必须回错误对象而不是抛，让模型还能把回答写完 */
  const takeExternalCallSlot = () =>
    ++externalCalls <= DISCOVERY_LIMITS.externalCallBudget;
  const budgetError = {
    error:
      "external search budget exhausted for this reply; answer from what you already have",
  };

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
        if (!takeExternalCallSlot()) return budgetError;
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
          console.error("[discovery] searchArxiv failed:", error);
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
        if (!takeExternalCallSlot()) return budgetError;
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
          console.error("[discovery] listDailyPapers failed:", error);
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
        if (!takeExternalCallSlot()) return budgetError;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          if (!res.ok) return { error: `arXiv API returned ${res.status}` };
          // 这份 output 要落库给卡片用，摘要按卡片口径再截一刀（见 cardAbstractChars）
          const entries = parseArxivAtom(await res.text()).map((e) => ({
            ...e,
            abstract: e.abstract.slice(0, DISCOVERY_LIMITS.cardAbstractChars),
          }));
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
          console.error("[discovery] recommendPapers failed:", error);
          return { error: "arXiv lookup failed; retry recommendPapers" };
        }
      },
    }),
  };
}
