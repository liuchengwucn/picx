/**
 * 把 Paraglide 的语言代码 (en/zh-CN/zh-TW/ja) 归一化为
 * summaries / tldr JSON 里使用的小写 key (en/zh-cn/zh-tw/ja)。
 */
export function normalizeLocaleKey(
  locale: string | undefined,
): "en" | "zh-cn" | "zh-tw" | "ja" {
  switch (locale) {
    case "zh-CN":
    case "zh-cn":
      return "zh-cn";
    case "zh-TW":
    case "zh-tw":
      return "zh-tw";
    case "ja":
      return "ja";
    default:
      return "en";
  }
}

const TLDR_FALLBACK_ORDER: Array<"en" | "zh-cn" | "zh-tw" | "ja"> = [
  "en",
  "zh-cn",
  "zh-tw",
  "ja",
];

/**
 * 仅从已生成的多语言 tldr 里取一句话总结, 用于 SEO meta:
 * 优先当前语言, 缺失则回退英文, 再缺失取任一可用语言。
 * 全部缺失返回 null, 由调用方决定更上层的兜底。
 *
 * gallery 已索引文章的 tldr 四语种齐全, 兜底仅为存量/未列出数据兜安全。
 */
export function pickTldr(
  tldr: Record<string, string> | null | undefined,
  localeKey: "en" | "zh-cn" | "zh-tw" | "ja",
): string | null {
  if (!tldr) return null;
  if (tldr[localeKey]) return tldr[localeKey];
  for (const key of TLDR_FALLBACK_ORDER) {
    if (tldr[key]) return tldr[key];
  }
  return null;
}
