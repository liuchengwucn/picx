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

  // X (Twitter) bot 凭证（OAuth 1.0a user context）
  X_API_KEY?: string;
  X_API_SECRET?: string;
  X_ACCESS_TOKEN?: string;
  X_ACCESS_SECRET?: string;
}
