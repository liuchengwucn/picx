import { describe, expect, it } from "vitest";
import { normalizeLocaleKey, pickTldr } from "./tldr";

describe("normalizeLocaleKey", () => {
  it("maps Paraglide locales to lowercase JSON keys", () => {
    expect(normalizeLocaleKey("zh-CN")).toBe("zh-cn");
    expect(normalizeLocaleKey("zh-TW")).toBe("zh-tw");
    expect(normalizeLocaleKey("ja")).toBe("ja");
    expect(normalizeLocaleKey("en")).toBe("en");
  });

  it("falls back to en for unknown/undefined locales", () => {
    expect(normalizeLocaleKey(undefined)).toBe("en");
    expect(normalizeLocaleKey("fr")).toBe("en");
  });
});

describe("pickTldr", () => {
  const full = {
    en: "English tldr",
    "zh-cn": "简体 tldr",
    "zh-tw": "繁體 tldr",
    ja: "日本語 tldr",
  };

  it("prefers the requested locale", () => {
    expect(pickTldr(full, "zh-cn")).toBe("简体 tldr");
    expect(pickTldr(full, "ja")).toBe("日本語 tldr");
  });

  it("falls back to en when the requested locale is missing", () => {
    expect(pickTldr({ en: "only en" }, "ja")).toBe("only en");
  });

  it("falls back to any available language when en is also missing", () => {
    expect(pickTldr({ "zh-tw": "only zh-tw" }, "ja")).toBe("only zh-tw");
  });

  it("returns null when no tldr is available", () => {
    expect(pickTldr(null, "en")).toBeNull();
    expect(pickTldr(undefined, "en")).toBeNull();
    expect(pickTldr({}, "en")).toBeNull();
  });
});
