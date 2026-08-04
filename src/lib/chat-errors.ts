/**
 * 论文 chatbot 的错误码与客户端可见限额的单一来源。
 *
 * 刻意只放类型与常量：`src/lib/chat.ts` 依赖 drizzle / R2 / OpenRouter，浏览器
 * 侧 import 会把整条服务端链路拖进 bundle。前端只需要这几个字面量，所以单拆一
 * 个零依赖模块，前后端共用，避免两边各抄一份码表后悄悄漂移。
 */

/**
 * `/api/chat` 下发的稳定错误码（不是给人看的文案，前端按码映射 i18n）。
 *
 * - `stream_failed` 与其他不同：它不走 HTTP 状态码，而是流已经开始之后以
 *   error part 下发，因此同样属于这张表。
 */
export const CHAT_ERROR_CODES = [
  "unauthorized",
  "bad_request",
  "message_too_long",
  "session_not_found",
  "forbidden",
  "session_full",
  "rate_limited_minute",
  "rate_limited_day",
  "stream_failed",
] as const;

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];

/** 前端也要感知的限额（输入框 maxLength 与服务端 413 判定必须同一个数） */
export const CHAT_CLIENT_LIMITS = {
  maxInputChars: 4000,
} as const;
