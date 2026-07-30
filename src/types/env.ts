/** Workers AI binding 的最小结构类型（项目未引入 @cloudflare/workers-types 的全局 Ai） */
export interface WorkersAi {
  run(model: string, options: Record<string, unknown>): Promise<unknown>;
}

/**
 * Cloudflare Workers Environment Bindings
 */
export interface Env {
  // Environment
  ENVIRONMENT?: "production" | "development";

  // Database
  DB: D1Database;

  // Storage
  PAPERS_BUCKET: R2Bucket;

  // Queue
  PAPER_QUEUE: Queue;

  // AI API Keys
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  GEMINI_API_KEY: string;
  GEMINI_BASE_URL?: string;
  GEMINI_MODEL?: string;
  CF_API_TOKEN?: string;

  // API key 加密密钥（用于加解密用户保存的第三方 API key）
  API_KEY_ENCRYPTION_SECRET?: string;

  // MinerU 标准 API token（PDF→markdown 解析）
  MINERU_TOKEN?: string;

  // X bot：每天自动直发 1 条到 X（OAuth 1.0a user context）
  X_API_KEY?: string;
  X_API_SECRET?: string;
  X_ACCESS_TOKEN?: string;
  X_ACCESS_SECRET?: string;
  // Telegram：仅在 X 发推失败时告警，供人工补发
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;

  /** Workers AI binding（news 聚合用 @cf/baai/bge-m3 做 embedding） */
  AI: WorkersAi;
  /** 自建 RSSHub 实例地址（可选；未配置时 rsshub 类型来源整体跳过） */
  RSSHUB_BASE_URL?: string;
  /** news 流水线专用模型覆盖（可选；缺省回落 OPENAI_MODEL） */
  NEWS_OPENAI_MODEL?: string;
}
