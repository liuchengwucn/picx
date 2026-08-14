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

/**
 * 只取模型配置真正用到的那几个绑定。写成窄接口而不是 Env，是为了让 tRPC 的
 * ctx.env（AppEnvBindings，没有 AI / GEMINI_* 等 workflow 侧绑定）也能直接传进来，
 * 不必在调用点写 `as unknown as Env` 这种会掩盖真实缺失的双重断言。
 */
export type DigestModelEnv = Pick<
  Env,
  | "OPENAI_API_KEY"
  | "OPENAI_BASE_URL"
  | "OPENAI_MODEL"
  | "DIGEST_CHEAP_MODEL"
  | "DIGEST_STRONG_MODEL"
  | "CF_API_TOKEN"
>;

export function cheapModel(env: DigestModelEnv): DigestModelConfig {
  return {
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
    model: env.DIGEST_CHEAP_MODEL || env.OPENAI_MODEL || DEFAULT_MODEL,
    cfApiToken: env.CF_API_TOKEN,
  };
}

export function strongModel(env: DigestModelEnv): DigestModelConfig {
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

/** 429 限流退避；瞬时并发峰值（角度打分/验证票）实跑撞过网关限流 */
const RATE_LIMIT_RETRY_DELAYS_MS = [15_000, 30_000];

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

  const started = Date.now();
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch(`${cfg.baseUrl}/chat/completions`, {
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
    if (response.status !== 429 || attempt >= RATE_LIMIT_RETRY_DELAYS_MS.length)
      break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 60_000)
        : RATE_LIMIT_RETRY_DELAYS_MS[attempt];
    console.warn(
      `[digest-ai] 429 rate limited, retry ${attempt + 1}/${RATE_LIMIT_RETRY_DELAYS_MS.length} in ${delay}ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
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
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  // 运维观测：逐次 LLM 调用的耗时与 token 用量；sys 头 60 字符足以人肉归类所属阶段
  console.log(
    `[digest-llm] ${cfg.model} ${Date.now() - started}ms in=${data.usage?.prompt_tokens ?? "?"} out=${data.usage?.completion_tokens ?? "?"} sys="${system.slice(0, 60).replace(/\n/g, " ")}"`,
  );
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
