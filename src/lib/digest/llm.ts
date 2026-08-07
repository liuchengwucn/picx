// src/lib/digest/llm.ts
import { extractFirstJsonObject } from "#/lib/json-extract";
import type { Env } from "#/types/env";

export interface DigestModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  cfApiToken?: string;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.2-instant";

export function cheapModel(env: Env): DigestModelConfig {
  return {
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
    model: env.DIGEST_CHEAP_MODEL || env.OPENAI_MODEL || DEFAULT_MODEL,
    cfApiToken: env.CF_API_TOKEN,
  };
}

export function strongModel(env: Env): DigestModelConfig {
  return {
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
    model: env.DIGEST_STRONG_MODEL || env.OPENAI_MODEL || DEFAULT_MODEL,
    cfApiToken: env.CF_API_TOKEN,
  };
}

export class DigestAiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DigestAiError";
  }
}

/** 折叠空白，供 prompt 拼接外部文本时用（降低 prompt injection 面） */
export function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

async function chat(
  cfg: DigestModelConfig,
  system: string,
  user: string,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  if (cfg.cfApiToken)
    headers["cf-aig-authorization"] = `Bearer ${cfg.cfApiToken}`;

  const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: maxTokens,
      // 关闭推理（OpenRouter 统一参数）：思考 token 计入 max_tokens，
      // 会把小预算调用顶到 finish_reason=length
      reasoning: { enabled: false },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new DigestAiError(
      `digest-ai: ${response.status} ${body.slice(0, 200)}`,
      response.status,
    );
  }
  const data = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string };
      finish_reason?: string;
    }>;
  };
  if (data.choices?.[0]?.finish_reason === "length") {
    throw new DigestAiError(
      "digest-ai: response truncated (finish_reason=length)",
    );
  }
  return data.choices?.[0]?.message?.content ?? "";
}

export async function chatJson<T>(
  cfg: DigestModelConfig,
  system: string,
  user: string,
  maxTokens: number,
  temperature = 0,
): Promise<T> {
  const content = await chat(cfg, system, user, maxTokens, temperature);
  const json = extractFirstJsonObject(content);
  if (!json) throw new DigestAiError("digest-ai: no JSON object in response");
  return JSON.parse(json) as T;
}
