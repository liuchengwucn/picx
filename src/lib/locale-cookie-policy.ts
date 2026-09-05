/**
 * 服务端 locale cookie 策略：给 server.ts 的 custom-negotiate 与响应侧的 Set-Cookie
 * 共用同一个判定，纯函数、可单测。
 *
 * 除了「没 cookie 就按 Accept-Language 协商」之外，还承担一次性的存量修复：
 * 2026-08-13 ~ 2026-09-05 期间客户端没注册 custom-negotiate，非英语浏览器的首访
 * 会被 runtime 把 `en` 写进 cookie 永久钉死。「被 bug 钉成 en」和「主动选了
 * English」在数据上无法区分，这里按产品决定只重置 cookie=en 且浏览器协商结果
 * 非 en 的那一交集（非英语浏览器却主动选英文的人会被重选一次；其他所有主动选择
 * 一律不碰）。
 *
 * 重置只能发生一次，靠 PICX_LOCALE_CHECKED 标记：它随每个 HTML 响应下发（不只是
 * 被重置的人，也不只是缺它的时候），表示「这个浏览器已经过修复后的代码」。
 * - 只给被重置者写：修复后新用户「先协商成中文、再主动选英文」会在下次访问被当成
 *   卡住的存量重置回去。
 * - 只在缺失时写：locale cookie 被 runtime 每次页面加载都续 400 天，标记却会先到期，
 *   到期那天主动选英文的人又被重置一次。
 * 存量 cookie 的 max-age 是 400 天，2027-09 之后这段重置逻辑可以删掉。
 */

import {
  type AppLocale,
  negotiateFromAcceptLanguage,
} from "#/lib/locale-negotiation";
import {
  baseLocale,
  cookieMaxAge,
  cookieName,
  isLocale,
} from "#/paraglide/runtime";

export const LOCALE_CHECKED_COOKIE = "PICX_LOCALE_CHECKED";

export interface LocaleDecision {
  /** 服务端应采用的 locale；undefined = 尊重现有 cookie，交给内置 cookie 策略 */
  locale: AppLocale | undefined;
  /** 需要随 HTML 响应下发的 Set-Cookie 值 */
  setCookies: string[];
}

// 同名 cookie 取第一个，与 runtime 内置 cookie 策略的读法一致，否则这里说
// 「尊重现有 cookie」时内置策略读到的可能是另一个值。
function parseCookies(header: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!out.has(name)) out.set(name, part.slice(eq + 1).trim());
  }
  return out;
}

// 格式与 runtime setLocale 写 cookie 的方式保持一致，让两边写的是同一个 cookie。
function localeCookie(locale: AppLocale): string {
  return `${cookieName}=${locale}; path=/; max-age=${cookieMaxAge}`;
}

const checkedCookie = `${LOCALE_CHECKED_COOKIE}=1; path=/; max-age=${cookieMaxAge}`;

export function decideRequestLocale(
  cookieHeader: string | null | undefined,
  acceptLanguage: string | null | undefined,
): LocaleDecision {
  const cookies = parseCookies(cookieHeader);
  const current = cookies.get(cookieName);
  const checked = cookies.get(LOCALE_CHECKED_COOKIE) === "1";
  const setCookies = [checkedCookie];

  if (isLocale(current)) {
    if (current === "en" && !checked) {
      const negotiated = negotiateFromAcceptLanguage(acceptLanguage);
      if (negotiated && negotiated !== "en") {
        setCookies.push(localeCookie(negotiated));
        return { locale: negotiated, setCookies };
      }
    }
    return { locale: undefined, setCookies };
  }

  // 没有合法 cookie 时一定钉一个下去，协商不出也钉 baseLocale：否则客户端会拿
  // navigator.languages（通常比 Accept-Language 长）自己再协商一次，两边可能不同。
  const negotiated = negotiateFromAcceptLanguage(acceptLanguage);
  setCookies.push(localeCookie(negotiated ?? baseLocale));
  return { locale: negotiated, setCookies };
}

/**
 * 只有 HTML 响应才带 Set-Cookie。按响应而不是按请求判：Googlebot 抓 sitemap/robots
 * 也带 Accept: text/html，那些响应是 public 可缓存的，挂上 cookie 会串给别人；
 * 而 SSR 侧的 locale 判定对每个请求都生效，HTML 响应一律带 cookie 才能保证两边收敛。
 */
export function isHtmlResponse(response: Response): boolean {
  return response.headers.get("content-type")?.includes("text/html") ?? false;
}

/** 把决策里的 Set-Cookie 附到响应上；没有要写的就原样返回。 */
export function withLocaleCookies(
  response: Response,
  decision: LocaleDecision,
): Response {
  if (decision.setCookies.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const cookie of decision.setCookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
