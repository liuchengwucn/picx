import { describe, expect, it } from "vitest";
import {
  negotiateFromAcceptLanguage,
  pickLocale,
} from "#/lib/locale-negotiation";

describe("pickLocale", () => {
  it("maps zh-HK / zh-MO to zh-TW", () => {
    expect(pickLocale(["zh-HK"])).toBe("zh-TW");
    expect(pickLocale(["zh-MO"])).toBe("zh-TW");
  });

  it("maps zh-SG and bare zh to zh-CN", () => {
    expect(pickLocale(["zh-SG"])).toBe("zh-CN");
    expect(pickLocale(["zh"])).toBe("zh-CN");
  });

  it("falls back to base language for unknown regional variants", () => {
    expect(pickLocale(["ja-Kana-JP"])).toBe("ja");
    expect(pickLocale(["en-AU"])).toBe("en");
  });

  it("is case-insensitive", () => {
    expect(pickLocale(["ZH-TW"])).toBe("zh-TW");
    expect(pickLocale(["Ja-JP"])).toBe("ja");
  });

  it("returns undefined when nothing matches", () => {
    expect(pickLocale(["fr", "de-DE"])).toBeUndefined();
    expect(pickLocale([])).toBeUndefined();
  });

  it("returns the first match in order", () => {
    expect(pickLocale(["fr", "ja", "zh-CN"])).toBe("ja");
  });
});

describe("negotiateFromAcceptLanguage", () => {
  it("returns undefined for null/undefined/empty header", () => {
    expect(negotiateFromAcceptLanguage(null)).toBeUndefined();
    expect(negotiateFromAcceptLanguage(undefined)).toBeUndefined();
    expect(negotiateFromAcceptLanguage("")).toBeUndefined();
  });

  it("picks the highest-q tag, not the first listed", () => {
    expect(negotiateFromAcceptLanguage("ja;q=0.5,zh-CN;q=0.9")).toBe("zh-CN");
  });

  it("treats missing q as 1", () => {
    expect(negotiateFromAcceptLanguage("zh-TW,ja;q=0.9")).toBe("zh-TW");
  });

  it("handles typical browser headers with spaces", () => {
    expect(negotiateFromAcceptLanguage("zh-CN, zh;q=0.9, en;q=0.8")).toBe(
      "zh-CN",
    );
  });

  it("maps zh-HK to zh-TW and zh-SG to zh-CN", () => {
    expect(negotiateFromAcceptLanguage("zh-HK")).toBe("zh-TW");
    expect(negotiateFromAcceptLanguage("zh-SG")).toBe("zh-CN");
  });

  it("maps bare zh to zh-CN", () => {
    expect(negotiateFromAcceptLanguage("zh;q=0.8,fr;q=0.9")).toBe("zh-CN");
  });

  it("is case-insensitive on tags", () => {
    expect(negotiateFromAcceptLanguage("ZH-hk")).toBe("zh-TW");
    expect(negotiateFromAcceptLanguage("JA")).toBe("ja");
  });

  it("skips unknown languages and falls to the next by q", () => {
    expect(negotiateFromAcceptLanguage("fr;q=1,ja;q=0.7,de;q=0.9")).toBe("ja");
  });

  it("returns undefined when no tag matches", () => {
    expect(negotiateFromAcceptLanguage("fr-FR,de;q=0.8")).toBeUndefined();
  });
});
