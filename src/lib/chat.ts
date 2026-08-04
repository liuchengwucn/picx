import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { tool } from "ai";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import type * as schema from "#/db/schema";
import { chatMessages, paperResults, papers } from "#/db/schema";
import { buildPaperMarkdown } from "#/lib/llm-markdown";
import { loadPaperText } from "#/lib/paper-text";
import { SITE_URL } from "#/lib/site-url";
import { normalizeLocaleKey } from "#/lib/tldr";

type Db = DrizzleD1Database<typeof schema>;

export const CHAT_LIMITS = {
  perMinute: 30,
  perDay: 500,
  maxInputChars: 4000,
  maxMessagesPerSession: 200,
  /** 送入模型的历史窗口（最近 N 条），历史全量仍在 D1 */
  historyWindow: 50,
  /** readPaper 每段字符数 */
  sectionChars: 24_000,
} as const;

interface ChatEnvVars {
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  CF_API_TOKEN?: string;
}

/** 系统配置直连（无 BYOK）：走 AI Gateway → OpenRouter，同 src/lib/ai.ts 通道 */
export function getChatModel(env: ChatEnvVars) {
  const openrouter = createOpenRouter({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL,
    headers: env.CF_API_TOKEN
      ? { "cf-aig-authorization": `Bearer ${env.CF_API_TOKEN}` }
      : undefined,
  });
  return openrouter.chat(env.OPENAI_MODEL ?? "gpt-5.2-instant");
}

/**
 * 论文访问校验：owner 或公开论文。无权限/不存在返回 null。
 */
export async function loadAccessiblePaper(
  db: Db,
  shortId: string,
  userId: string,
) {
  const [paper] = await db
    .select()
    .from(papers)
    .where(and(eq(papers.shortId, shortId), isNull(papers.deletedAt)))
    .limit(1);
  if (!paper) return null;
  if (paper.userId !== userId && !paper.isPublic) return null;
  return paper;
}

/** 拼系统提示：论文摘要上下文（buildPaperMarkdown 复用）+ 行为指令 */
export async function buildChatSystemPrompt(
  db: Db,
  paper: typeof papers.$inferSelect,
  locale: string,
): Promise<string> {
  const [result] = await db
    .select()
    .from(paperResults)
    .where(eq(paperResults.paperId, paper.id))
    .limit(1);
  const langKey = normalizeLocaleKey(locale);
  const summaries =
    (result?.summaries as Record<string, string> | null) ?? null;
  const tldrMap = (result?.tldr as Record<string, string> | null) ?? null;
  const paperMd = buildPaperMarkdown({
    title: paper.title,
    shortId: paper.shortId,
    summary: summaries
      ? (summaries[langKey] ??
        summaries.en ??
        Object.values(summaries)[0] ??
        null)
      : null,
    tldr: tldrMap ? (tldrMap[langKey] ?? tldrMap.en ?? null) : null,
    sourceType: paper.sourceType,
    sourceUrl: paper.sourceUrl,
    publishedAt: paper.publishedAt,
    hasWhiteboard: false,
    siteUrl: SITE_URL,
  });
  return [
    "You are a research assistant embedded on a paper page of PicX. Help the user understand this paper.",
    "",
    "Rules:",
    "- Answer in the same language the user writes in.",
    "- The summary below may not contain enough detail. For questions about specific methods, equations, experiments, or references, call the readPaper tool to read the paper's full text before answering.",
    "- Web search results may be injected automatically; when you use them, cite the source URLs.",
    "- If something is not in the paper and cannot be found, say so plainly. Do not fabricate.",
    "",
    "## Paper context",
    "",
    paperMd,
  ].join("\n");
}

/** readPaper 工具的返回形状：error 与 section 结果统一成一个形状，避免 execute 返回类型是 union */
interface ReadPaperResult {
  error?: string;
  section?: number;
  sectionCount?: number;
  text?: string;
}

/** chatbot 的本地工具集 */
export function buildChatTools(bucket: R2Bucket, paperId: string) {
  return {
    readPaper: tool({
      description:
        "Read the paper's full text. Text is split into fixed-size sections; start with section 1. The response includes sectionCount so you can read further sections.",
      inputSchema: z.object({
        section: z
          .number()
          .int()
          .min(1)
          .describe("1-based section index")
          .default(1),
      }),
      execute: async ({ section }): Promise<ReadPaperResult> => {
        const text = await loadPaperText(bucket, paperId);
        if (!text) {
          return {
            error:
              "Full text is not available for this paper. Answer from the paper context in the system prompt.",
          };
        }
        return sliceSection(text, section);
      },
    }),
  };
}

/** 纯函数便于测试：把全文切成 sectionChars 大小的段并取第 section 段 */
export function sliceSection(text: string, section: number) {
  const size = CHAT_LIMITS.sectionChars;
  const sectionCount = Math.max(1, Math.ceil(text.length / size));
  const idx = Math.min(Math.max(section, 1), sectionCount) - 1;
  return {
    section: idx + 1,
    sectionCount,
    text: text.slice(idx * size, (idx + 1) * size),
  };
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; code: "rate_limited_minute" | "rate_limited_day" };

/** 滑动窗口限流：数 chat_messages 里该用户最近的 user 消息（命中 user_rate_idx） */
export async function checkChatRateLimit(
  db: Db,
  userId: string,
): Promise<RateLimitResult> {
  const now = Date.now();
  const countSince = async (since: number) => {
    const [row] = await db
      .select({ n: count() })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.userId, userId),
          eq(chatMessages.role, "user"),
          gt(chatMessages.createdAt, new Date(since)),
        ),
      );
    return row?.n ?? 0;
  };
  if ((await countSince(now - 60_000)) >= CHAT_LIMITS.perMinute) {
    return { ok: false, code: "rate_limited_minute" };
  }
  if ((await countSince(now - 86_400_000)) >= CHAT_LIMITS.perDay) {
    return { ok: false, code: "rate_limited_day" };
  }
  return { ok: true };
}
