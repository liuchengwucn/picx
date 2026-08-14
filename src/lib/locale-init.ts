/**
 * 浏览器早期的 locale cookie 同步（__root.tsx beforeLoad 调用，幂等）。
 *
 * SSR 按 cookie 渲染 locale（见 src/server.ts），所以老用户 localStorage 里的
 * locale 必须回填到 cookie，否则 SSR 与客户端渲染不一致（hydration #418）。
 * cookie 已存在合法 locale 时什么都不做；两边都没有时也不写，
 * 服务端和客户端会一致地落到 baseLocale (en)。
 */

import { type AppLocale, pickLocale } from "#/lib/locale-negotiation";
import {
  cookieMaxAge,
  cookieName,
  locales,
  localStorageKey,
} from "#/paraglide/runtime";

function isAppLocale(value: string | null | undefined): value is AppLocale {
  return !!value && locales.includes(value as AppLocale);
}

export function initLocale() {
  // Skip if we're on the server
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return;
  }

  // cookie 里已有合法 locale → 幂等退出
  const cookieMatch = document.cookie.match(
    new RegExp(`(?:^| )${cookieName}=([^;]+)`),
  );
  if (isAppLocale(cookieMatch?.[1])) {
    return;
  }

  const storedLocale = localStorage.getItem(localStorageKey);
  const resolved = isAppLocale(storedLocale)
    ? storedLocale
    : pickLocale(navigator.languages || [navigator.language]);

  if (resolved) {
    // 格式与 runtime setLocale 写 cookie 的方式保持一致。
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API 是异步且浏览器覆盖不全，paraglide runtime 本身也是同样写法
    document.cookie = `${cookieName}=${resolved}; path=/; max-age=${cookieMaxAge}`;
    localStorage.setItem(localStorageKey, resolved);
  }
}
