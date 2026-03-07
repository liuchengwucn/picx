/**
 * Initialize locale based on browser language preference
 * This runs before paraglide's preferredLanguage strategy
 */

import { locales, localStorageKey } from "#/paraglide/runtime";

/**
 * Map browser language codes to our supported locales
 */
const LANGUAGE_MAP: Record<string, string> = {
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
 * Initialize locale on first visit
 * If localStorage already has a locale, do nothing
 * Otherwise, detect browser language and set it
 */
export function initLocale() {
  // Skip if we're on the server
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return;
  }

  // Skip if user has already set a locale
  const storedLocale = localStorage.getItem(localStorageKey);
  if (storedLocale) {
    return;
  }

  // Get browser languages
  const browserLanguages = navigator.languages || [navigator.language];

  // Try to find a matching locale
  for (const lang of browserLanguages) {
    const normalizedLang = lang.toLowerCase();

    // Try exact match first
    const mapped = LANGUAGE_MAP[normalizedLang];
    if (mapped && locales.includes(mapped as any)) {
      localStorage.setItem(localStorageKey, mapped);
      return;
    }

    // Try base language (e.g., "zh" from "zh-TW")
    const baseLang = normalizedLang.split("-")[0];
    const baseMapped = LANGUAGE_MAP[baseLang];
    if (baseMapped && locales.includes(baseMapped as any)) {
      localStorage.setItem(localStorageKey, baseMapped);
      return;
    }
  }

  // If no match found, paraglide will use baseLocale (en)
}
