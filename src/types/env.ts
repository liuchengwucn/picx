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

  // X bot：每天把选出的论文推送到 Telegram 供人工发推
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}
