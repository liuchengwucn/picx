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

  // Workers AI binding（news 聚合用 @cf/baai/bge-m3 做 embedding）
  AI: Ai;
  // Workers AI REST API 凭据（可选）：两者齐备时 embed 走 REST 而非 binding，
  // 供 binding 不可用的环境（如本地 dev 关闭 remote bindings）使用；生产不配置
  CLOUDFLARE_ACCOUNT_ID?: string;
  WORKERS_AI_API_TOKEN?: string;
  // 自建 RSSHub 实例地址（可选；未配置时 rsshub 类型来源整体跳过）
  RSSHUB_BASE_URL?: string;
  RSSHUB_ACCESS_KEY?: string;
  // news 流水线专用模型覆盖（可选；缺省回落 OPENAI_MODEL）
  NEWS_OPENAI_MODEL?: string;
  // 生产环境手动触发 /__scheduled 的密钥（可选；未配置时生产一律 404）
  CRON_TRIGGER_KEY?: string;
  // news 摄入/活跃窗口小时数覆盖（可选；仅用于历史回填等运维场景，默认 72）
  NEWS_INGEST_WINDOW_HOURS?: string;

  // IndexNow（可选；未配置时所有 ping 直接跳过）
  INDEXNOW_KEY?: string;

  // Gallery 方向化（direction digest）
  DIGEST_WORKFLOW: Workflow;
  DIGEST_CHEAP_MODEL?: string; // 扫源初筛/精读/对抗投票，回落 OPENAI_MODEL
  DIGEST_STRONG_MODEL?: string; // Scope 分解/定稿，回落 OPENAI_MODEL
  // 站长 userId 白名单（逗号分隔，可选；未配置时管理面对所有人 403/404）
  ADMIN_USER_IDS?: string;
}
