/**
 * 源 config 的前端校验，与后端 upsertSourceInput（src/integrations/trpc/routers/admin.ts）
 * 的 zod 逐条镜像。
 *
 * 为什么必须镜像而不是「让后端报错就行」：src/ 里没有任何 tRPC errorFormatter，默认
 * 的 shape 不带 zodError，客户端只拿到 code: BAD_REQUEST 加一段 ZodError 的 JSON 串，
 * adminErrorMessage 匹配不上就落到「出了点问题」。也就是说后端 superRefine 里那些
 * issue path 到不了 UI —— 站长看到的每一条字段级提示都只来自这里。
 * （统一下发/脱敏 zodError 是独立待办，不在这条链上做。）
 *
 * 刻意做成不碰 paraglide 的纯函数：文案由调用方按 kind 映射。仓库里没有组件测试
 * 基建（无 @testing-library），抽出来才测得到 —— 而这里最需要测的恰恰是「判定与
 * 后端严格一致」，见 admin.test.ts 里那张前后端对照表。
 */

/**
 * 与后端 z.enum(["arxiv_query", "rss"]) 对齐。调用方传的是从 tRPC 路由类型推出来的
 * adapterType，所以将来后端多一个适配器、这里没跟上的话，调用处会直接类型不通过。
 */
export type SourceAdapterType = "arxiv_query" | "rss";

/**
 * 每个适配器的必填字段，与后端 superRefine 的两支逐条对应：
 * arxiv_query 缺 query、rss 缺 url 都是适配器侧的硬 throw（lib/digest/sources.ts）。
 */
export const REQUIRED_CONFIG_FIELD: Record<SourceAdapterType, "query" | "url"> =
  {
    arxiv_query: "query",
    rss: "url",
  };

export type SourceConfigProblem =
  | { kind: "missing"; field: "query" | "url" }
  | { kind: "bad_url" }
  | { kind: "bad_max_results" };

/**
 * 与后端 z.string().url() 判定完全一致的 URL 检查。两处细节都是必须的：
 *
 * - **先 trim**：zod 4 的 url 检查在 new URL() 之前先 trim 掉首尾空白，而 WHATWG 的
 *   URL 解析只剥 C0 控制符与空格。从中文网页/聊天窗口/PDF 里复制 RSS 地址很容易粘上
 *   一个不换行空格（U+00A0）、全角空格（U+3000）或 BOM（U+FEFF）——屏幕上完全看不见。
 *   不 trim 就会拦掉一份后端本来会接受的配置，而站长对着一条「看起来完全正确」的
 *   URL 束手无策，正是这条校验想消除的那种「说不清哪里错了」。20 个用例实测：
 *   trim 后与 zod 零 mismatch，不 trim 有 4 条（三种不可见前导空白 + 尾部 NBSP）。
 * - **用 try/catch 而不是 URL.canParse**：canParse 是 Baseline 2023（Safari 17 /
 *   Chrome 120），项目既没有 browserslist 也没有 polyfill 配置，旧浏览器上它会在
 *   submit 里抛 TypeError，按钮看着像坏的。规范里 canParse 的定义就是「new URL()
 *   会不会抛」，所以这是逐字等价的替换，白拿兼容性。
 */
function parsesAsUrl(value: string): boolean {
  try {
    new URL(value.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * 返回第一条问题，全都合规则返回 null。
 *
 * 只查「该有的有没有、填了的合不合法」：切换适配器类型后残留的无关字段（rss 的
 * config 里还留着 query）是无害残留，拦住它只会让站长改不动配置。未知键（拼错的
 * 字段名）同样不在这里报错 —— 后端 zod 的默认 strip 会把它剥掉，剥掉之后必填项
 * 就缺了，由上面那条必填判定统一抓住。
 */
export function checkSourceConfig(
  adapterType: SourceAdapterType,
  config: Record<string, unknown>,
): SourceConfigProblem | null {
  const field = REQUIRED_CONFIG_FIELD[adapterType];
  const required = config[field];
  if (typeof required !== "string" || !required.trim())
    return { kind: "missing", field };

  // url 的合法性与 adapterType 无关：后端的 sourceConfig.url 是
  // z.string().url().optional()，只要这个键在就要过 .url()，残留的 url 也不例外
  const url = config.url;
  if (url !== undefined && (typeof url !== "string" || !parsesAsUrl(url)))
    return { kind: "bad_url" };

  // 同理，后端是 z.number().int().positive().optional()：0 / -1 / 1.5 / "50" 全过不了，
  // 而 maxResults 不在必填之列，漏掉它就又是一条「说不清哪里错了」的 400
  const maxResults = config.maxResults;
  if (
    maxResults !== undefined &&
    (typeof maxResults !== "number" ||
      !Number.isInteger(maxResults) ||
      maxResults <= 0)
  )
    return { kind: "bad_max_results" };

  return null;
}
