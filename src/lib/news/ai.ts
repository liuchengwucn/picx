import type { AIConfig } from "#/lib/ai";

// ---- 通用：OpenAI-compatible chat + JSON 输出 ----

function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

async function chatJson<T>(
  config: AIConfig,
  system: string,
  user: string,
  maxTokens: number,
): Promise<T> {
  const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
  const model = config.openaiModel || "gpt-5.2-instant";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.openaiApiKey}`,
  };
  // 如果配置了 Cloudflare API Token，添加 AI Gateway 认证头（同 lib/ai.ts 惯例）
  if (config.cfApiToken)
    headers["cf-aig-authorization"] = `Bearer ${config.cfApiToken}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(`news-ai: ${response.status} ${response.statusText}`);
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const json = extractJson(content);
  if (!json) throw new Error("news-ai: no JSON object in response");
  return JSON.parse(json) as T;
}

// ---- 相关性过滤（批量） ----

export interface RelevanceInput {
  title: string;
  excerpt?: string | null;
}

const FILTER_SYSTEM = `You score items for an AI-frontier news aggregator whose audience cares most about LLM pretraining, model architectures, training infrastructure, scaling, major lab/model releases, and high-signal AI industry news.
Score each item 0-100 combining topical relevance and content quality. Marketing fluff, job posts, generic listicles, crypto, and non-AI content score below 30. Serious technical posts, notable releases, and widely-discussed AI news score above 60.
Reply with JSON only: {"scores": [n, ...]} with exactly one integer per item, in order.`;

export async function scoreRelevance(
  items: RelevanceInput[],
  config: AIConfig,
): Promise<number[]> {
  const list = items
    .map(
      (item, i) =>
        `${i + 1}. ${item.title}\n${(item.excerpt ?? "").slice(0, 300)}`,
    )
    .join("\n---\n");
  const result = await chatJson<{ scores: number[] }>(
    config,
    FILTER_SYSTEM,
    list,
    500,
  );
  if (!Array.isArray(result.scores) || result.scores.length !== items.length) {
    throw new Error(
      `news-ai: scores length mismatch (${result.scores?.length} vs ${items.length})`,
    );
  }
  return result.scores.map((s) => Math.max(0, Math.min(100, Math.round(s))));
}

// ---- 聚类精判 ----

export interface CandidateStory {
  title: string;
  summary: string;
}

const JUDGE_SYSTEM = `You decide whether a news item belongs to an existing story cluster. A story = one concrete news event (e.g. one model release, one paper, one incident). Related-but-different events (a release vs. criticism of a different model) are different stories.
Reply with JSON only: {"assign": <1-based candidate number>} or {"assign": null} if none match.`;

export async function judgeAssignment(
  item: { title: string; excerpt?: string | null },
  candidates: CandidateStory[],
  config: AIConfig,
): Promise<number | null> {
  const user = `ITEM:\n${item.title}\n${(item.excerpt ?? "").slice(0, 300)}\n\nCANDIDATE STORIES:\n${candidates
    .map((c, i) => `${i + 1}. ${c.title} — ${c.summary.slice(0, 200)}`)
    .join("\n")}`;
  const result = await chatJson<{ assign: number | null }>(
    config,
    JUDGE_SYSTEM,
    user,
    100,
  );
  if (result.assign === null || result.assign === undefined) return null;
  const idx = Number(result.assign) - 1;
  return idx >= 0 && idx < candidates.length ? idx : null;
}

// ---- 四语 story 标题+摘要 ----

export interface StoryContent {
  title: Record<string, string>;
  summary: Record<string, string>;
  tags: string[];
}

const SUMMARY_SYSTEM = `You write the canonical headline and summary for a news story aggregated from multiple sources, for an audience of AI/LLM researchers and engineers.
Write a neutral, information-dense headline (<= 90 chars in English) and a 2-3 sentence summary of what happened and why it matters. Do not editorialize.
Produce all four languages: en, zh-cn (简体中文), zh-tw (繁體中文), ja (日本語) — native phrasing, not literal translation. Also give 2-4 short lowercase English topic tags.
Reply with JSON only:
{"title": {"en": "...", "zh-cn": "...", "zh-tw": "...", "ja": "..."}, "summary": {"en": "...", "zh-cn": "...", "zh-tw": "...", "ja": "..."}, "tags": ["..."]}`;

const LOCALE_KEYS = ["en", "zh-cn", "zh-tw", "ja"] as const;

export async function generateStoryContent(
  items: Array<{ title: string; excerpt?: string | null; sourceName: string }>,
  config: AIConfig,
): Promise<StoryContent> {
  const user = items
    .slice(0, 20)
    .map(
      (item) =>
        `[${item.sourceName}] ${item.title}\n${(item.excerpt ?? "").slice(0, 400)}`,
    )
    .join("\n---\n");
  const result = await chatJson<StoryContent>(
    config,
    SUMMARY_SYSTEM,
    user,
    1600,
  );
  for (const key of LOCALE_KEYS) {
    if (!result.title?.[key] || !result.summary?.[key]) {
      throw new Error(`news-ai: story content missing locale ${key}`);
    }
  }
  return {
    title: result.title,
    summary: result.summary,
    tags: Array.isArray(result.tags) ? result.tags.slice(0, 4) : [],
  };
}

// ---- embedding（Workers AI bge-m3，1024 维） ----

// Ai 是 @cloudflare/workers-types 的全局环境类型，无需 import
export async function embedTexts(
  ai: Ai,
  texts: string[],
): Promise<Float32Array[]> {
  const result = (await ai.run("@cf/baai/bge-m3", { text: texts })) as {
    data?: number[][];
  };
  if (!result.data || result.data.length !== texts.length) {
    throw new Error("news-ai: unexpected bge-m3 response shape");
  }
  return result.data.map((vector) => new Float32Array(vector));
}
