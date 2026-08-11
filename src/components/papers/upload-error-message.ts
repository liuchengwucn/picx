import type { UploadErrorCode } from "#/lib/upload-errors";
import { m } from "#/paraglide/messages";

/**
 * 论文上传链路（/api/papers/upload、/api/papers/fetch-url、tRPC paper.create）
 * 的稳定错误码 → 本地化文案。码表见 lib/upload-errors.ts。
 *
 * 值必须是**惰性取值的箭头函数**：模块在首帧就求值的话，读到的是加载当刻的
 * 语言，而不是出错当刻的语言。
 *
 * 刻意不给专属文案（落 generic）的码：
 * - missing_filename / read_failed：客户端自己拼的请求，出现即编程错误
 * - invalid_r2_key：防篡改路径，正常用户永远碰不到
 * 给它们写专属文案只是白白增加四个语言包的翻译负担。
 */
const UPLOAD_ERROR_MESSAGE: Partial<Record<UploadErrorCode, () => string>> = {
  bad_url: () => m.upload_url_err_bad_url(),
  blocked: () => m.upload_url_err_blocked(),
  // not_pdf 来自链接导入（「该链接不是 PDF」），not_pdf_file 来自本地直传
  // （「该文件不是有效的 PDF」）——两个码正是为了这两句话才分开的。
  not_pdf: () => m.upload_url_err_not_pdf(),
  not_pdf_file: () => m.upload_err_not_pdf(),
  too_large: () => m.upload_err_too_large(),
  timeout: () => m.upload_url_err_fetch_failed(),
  fetch_failed: () => m.upload_url_err_fetch_failed(),
  unauthorized: () => m.upload_err_unauthorized(),
  empty_file: () => m.upload_err_empty_file(),
  api_config_not_found: () => m.upload_err_api_config_not_found(),
  prompt_not_found: () => m.upload_err_prompt_not_found(),
  insufficient_credits: () => m.error_insufficient_credits(),
};

/**
 * 码 → 本地化文案。未知码（含没登记专属文案的码）落 `fallback`，默认 generic。
 */
export function localizeUploadErrorCode(
  code: string,
  fallback?: () => string,
): string {
  // Object.hasOwn 而非直接索引：对象字面量继承了 toString / valueOf 等原型成员，
  // 未知码若撞上它们会取到函数并渲染出 "[object Object]" 之类的垃圾，甚至抛
  // TypeError。只认自有属性。
  if (Object.hasOwn(UPLOAD_ERROR_MESSAGE, code)) {
    const render = UPLOAD_ERROR_MESSAGE[code as UploadErrorCode];
    if (render) {
      return render();
    }
  }
  return fallback?.() ?? m.upload_err_generic();
}

/**
 * `Error.message` 就是服务端下发的码（HTTP 错误体的 `error` 字段与 TRPCError 的
 * `message` 都被原样搬进来）。非 Error（网络层抛的怪东西）落 `fallback`。
 *
 * 注意：无法识别时**绝不**把原始 message 甩给用户——那正是这套码要根治的
 * 「中文界面弹英文串」。
 */
export function localizeUploadError(
  error: unknown,
  fallback?: () => string,
): string {
  if (error instanceof Error) {
    return localizeUploadErrorCode(error.message, fallback);
  }
  return fallback?.() ?? m.upload_err_generic();
}
