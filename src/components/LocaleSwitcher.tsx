// Locale switcher refs:
// - Paraglide docs: https://inlang.com/m/gerre34r/library-inlang-paraglideJs
// - Router example: https://github.com/TanStack/router/tree/main/examples/react/i18n-paraglide#switching-locale

import { Languages } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { getLocale, locales, setLocale } from "#/paraglide/runtime";

const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
};

export default function ParaglideLocaleSwitcher() {
  const currentLocale = getLocale();

  return (
    <Select value={currentLocale} onValueChange={(value) => setLocale(value)}>
      <SelectTrigger className="w-[140px] h-9">
        <div className="flex items-center gap-1.5 w-full">
          <Languages className="h-4 w-4 shrink-0" />
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent>
        {locales.map((locale) => (
          <SelectItem key={locale} value={locale}>
            {LOCALE_NAMES[locale] || locale}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
