/**
 * 浏览器语言标签 → 应用 locale 的共享映射与协商逻辑。
 * 被服务端 (server.ts 的 custom-negotiate 策略) 和客户端 (locale-init.ts)
 * 共同 import，必须保持纯函数、无副作用。
 */

import { locales } from "#/paraglide/runtime";

export type AppLocale = (typeof locales)[number];

/**
 * Map browser language codes to our supported locales
 */
export const LANGUAGE_MAP: Record<string, AppLocale> = {
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-sg": "zh-CN",
  "zh-tw": "zh-TW",
  "zh-hant": "zh-TW",
  "zh-hk": "zh-TW",
  "zh-mo": "zh-TW",
  ja: "ja",
  "ja-jp": "ja",
  en: "en",
  "en-us": "en",
  "en-gb": "en",
};

/**
 * 按顺序对每个语言标签做匹配：先小写化查全量映射，再退到 base 语言
 * (如 "zh-TW" → "zh")，返回第一个命中的应用 locale。
 */
export function pickLocale(tags: readonly string[]): AppLocale | undefined {
  for (const tag of tags) {
    const normalized = tag.toLowerCase();

    const mapped = LANGUAGE_MAP[normalized];
    if (mapped && locales.includes(mapped)) {
      return mapped;
    }

    const baseLang = normalized.split("-")[0];
    const baseMapped = LANGUAGE_MAP[baseLang];
    if (baseMapped && locales.includes(baseMapped)) {
      return baseMapped;
    }
  }
  return undefined;
}

/**
 * 解析 Accept-Language 头（逗号分隔、`;q=` 权重、缺省 q=1），
 * 按 q 降序取标签序列后走 pickLocale。
 */
export function negotiateFromAcceptLanguage(
  header: string | null | undefined,
): AppLocale | undefined {
  if (!header) {
    return undefined;
  }

  const tags = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      let q = 1;
      for (const param of params) {
        const match = param.trim().match(/^q=([\d.]+)$/i);
        if (match) {
          const parsed = Number(match[1]);
          if (!Number.isNaN(parsed)) {
            q = parsed;
          }
        }
      }
      return { tag: tag.trim(), q };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.tag);

  return pickLocale(tags);
}
