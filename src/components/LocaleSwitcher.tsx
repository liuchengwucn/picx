// Locale switcher refs:
// - Paraglide docs: https://inlang.com/m/gerre34r/library-inlang-paraglideJs
// - Router example: https://github.com/TanStack/router/tree/main/examples/react/i18n-paraglide#switching-locale

import { getLocale, locales, setLocale } from "#/paraglide/runtime";

const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

export default function ParaglideLocaleSwitcher() {
  const currentLocale = getLocale();

  return (
    <div
      style={{
        display: "flex",
        gap: "0.25rem",
        alignItems: "center",
      }}
    >
      {locales.map((locale) => (
        <button
          key={locale}
          onClick={() => setLocale(locale)}
          aria-pressed={locale === currentLocale}
          style={{
            cursor: "pointer",
            padding: "0.35rem 0.75rem",
            borderRadius: "999px",
            border: "1px solid var(--line)",
            background:
              locale === currentLocale
                ? "var(--surface-strong)"
                : "transparent",
            color: "inherit",
            fontWeight: locale === currentLocale ? 600 : 500,
            letterSpacing: "0.01em",
            fontSize: "0.875rem",
          }}
        >
          {LOCALE_NAMES[locale] || locale}
        </button>
      ))}
    </div>
  );
}
