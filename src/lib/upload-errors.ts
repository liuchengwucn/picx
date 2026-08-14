/**
 * 论文上传链路的稳定错误码单一来源。
 *
 * 这些码是**服务端与客户端之间的契约**：/api/papers/upload、
 * /api/papers/fetch-url 与 tRPC paper.create 一律只返回码，绝不返回人类可读
 * 文案；本地化由客户端的 `components/papers/upload-error-message.ts` 负责。
 * 增删改任何一个码都必须两侧同步，否则用户会静默落到 generic 兜底文案。
 *
 * 传递方式：码被原样塞进 HTTP 错误体的 `error` 字段 / TRPCError 的 `message`，
 * 到客户端就是 `Error.message`。所以码必须是稳定的机器串——一旦这里写了英文
 * 句子，中文/日文用户就会看到英文报错（这正是本模块要根治的问题）。
 *
 * 本文件刻意零依赖、**不 import paraglide**：它同时被 Worker 侧代码引用，而
 * paraglide 是客户端 i18n 产物，不该被牵连进 Worker bundle（同 chat-errors.ts）。
 */

export const UPLOAD_ERROR = {
  // ---- /api/papers/upload ----
  UNAUTHORIZED: "unauthorized",
  MISSING_FILENAME: "missing_filename",
  READ_FAILED: "read_failed",
  EMPTY_FILE: "empty_file",
  TOO_LARGE: "too_large",
  /**
   * 与下面的 NOT_PDF_URL 刻意分成两个码：同一件事（拿到的字节不是 PDF）在两条
   * 路径上要说两句不同的话——直传是「这个**文件**不是有效的 PDF」，链接导入是
   * 「这个**链接**不是 PDF 文件」。合成一个码只能给出含糊文案，所以分开。
   */
  NOT_PDF_FILE: "not_pdf_file",

  // ---- /api/papers/fetch-url（既有码，此处登记以便客户端穷举映射）----
  BAD_URL: "bad_url",
  BLOCKED: "blocked",
  NOT_PDF_URL: "not_pdf",
  TIMEOUT: "timeout",
  FETCH_FAILED: "fetch_failed",

  // ---- 客户端自产（没有任何服务端会下发）----
  /**
   * 「响应本身解析不了」：网关在 200 或错误响应里插了一页 HTML，拿不到 JSON。
   * 与服务端的 READ_FAILED（worker 读取**上传体**失败）刻意分开——两者用户可见
   * 文案都是 generic，但 console.error 里印出哪个码决定了排查方向。
   */
  BAD_RESPONSE: "bad_response",

  // ---- tRPC paper.create ----
  INVALID_R2_KEY: "invalid_r2_key",
  API_CONFIG_NOT_FOUND: "api_config_not_found",
  PROMPT_NOT_FOUND: "prompt_not_found",
  INSUFFICIENT_CREDITS: "insufficient_credits",
} as const;

export type UploadErrorCode = (typeof UPLOAD_ERROR)[keyof typeof UPLOAD_ERROR];
