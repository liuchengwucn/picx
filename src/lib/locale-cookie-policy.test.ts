import { describe, expect, it } from "vitest";
import {
  decideRequestLocale,
  isHtmlResponse,
  LOCALE_CHECKED_COOKIE,
  withLocaleCookies,
} from "#/lib/locale-cookie-policy";

const ATTRS = "; path=/; max-age=34560000";
const CHECKED = `${LOCALE_CHECKED_COOKIE}=1`;
const CHECKED_FULL = `${CHECKED}${ATTRS}`;
const localeCookie = (l: string) => `PARAGLIDE_LOCALE=${l}${ATTRS}`;

describe("decideRequestLocale", () => {
  it("negotiates and persists on a cookieless first visit", () => {
    const d = decideRequestLocale(null, "zh-CN,zh;q=0.9");
    expect(d.locale).toBe("zh-CN");
    // 属性必须与 runtime setLocale 写的一字不差，否则是两个不同的 cookie
    expect(d.setCookies).toEqual([CHECKED_FULL, localeCookie("zh-CN")]);
  });

  it("pins baseLocale when nothing negotiates so the client cannot disagree", () => {
    const d = decideRequestLocale(null, "fr-FR,fr;q=0.8");
    expect(d.locale).toBeUndefined();
    expect(d.setCookies).toEqual([CHECKED_FULL, localeCookie("en")]);
  });

  it("respects a non-en cookie even without the marker", () => {
    const d = decideRequestLocale("PARAGLIDE_LOCALE=zh-TW", "zh-CN");
    expect(d.locale).toBeUndefined();
    expect(d.setCookies).toEqual([CHECKED_FULL]);
  });

  it("resets an unmarked en cookie when the browser prefers another locale", () => {
    const d = decideRequestLocale("_ga=x; PARAGLIDE_LOCALE=en", "ja,en;q=0.5");
    expect(d.locale).toBe("ja");
    expect(d.setCookies).toEqual([CHECKED_FULL, localeCookie("ja")]);
  });

  it("keeps an unmarked en cookie for English or unsupported browsers", () => {
    for (const accept of ["en-US", "fr", null]) {
      const d = decideRequestLocale("PARAGLIDE_LOCALE=en", accept);
      expect(d.locale).toBeUndefined();
      expect(d.setCookies).toEqual([CHECKED_FULL]);
    }
  });

  it("never touches an en cookie once the browser is marked, but keeps refreshing the marker", () => {
    const d = decideRequestLocale(`PARAGLIDE_LOCALE=en; ${CHECKED}`, "zh-CN");
    expect(d.locale).toBeUndefined();
    expect(d.setCookies).toEqual([CHECKED_FULL]);
  });

  it("negotiates when the cookie holds garbage", () => {
    const d = decideRequestLocale(`PARAGLIDE_LOCALE=xx; ${CHECKED}`, "ja");
    expect(d.locale).toBe("ja");
    expect(d.setCookies).toEqual([CHECKED_FULL, localeCookie("ja")]);
  });

  it("reads the first duplicate like paraglide's own cookie strategy does", () => {
    const d = decideRequestLocale(
      "PARAGLIDE_LOCALE=zh-TW; PARAGLIDE_LOCALE=en",
      "zh-CN",
    );
    expect(d.locale).toBeUndefined();
    expect(d.setCookies).toEqual([CHECKED_FULL]);
  });
});

describe("isHtmlResponse", () => {
  it("keys off the response content type only", () => {
    const html = new Response("", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const xml = new Response("", {
      headers: {
        "content-type": "application/xml",
        "cache-control": "public, max-age=3600",
      },
    });
    expect(isHtmlResponse(html)).toBe(true);
    expect(isHtmlResponse(xml)).toBe(false);
    expect(isHtmlResponse(new Response(null, { status: 304 }))).toBe(false);
  });
});

describe("withLocaleCookies", () => {
  it("appends every cookie and preserves status and existing headers", async () => {
    const original = new Response("<html/>", {
      status: 404,
      headers: { "content-type": "text/html", "set-cookie": "a=1" },
    });
    const out = withLocaleCookies(original, {
      locale: "ja",
      setCookies: ["PARAGLIDE_LOCALE=ja; path=/", `${CHECKED}; path=/`],
    });
    expect(out.status).toBe(404);
    expect(out.headers.get("content-type")).toBe("text/html");
    expect(out.headers.getSetCookie()).toEqual([
      "a=1",
      "PARAGLIDE_LOCALE=ja; path=/",
      `${CHECKED}; path=/`,
    ]);
    expect(await out.text()).toBe("<html/>");
  });

  it("passes a streaming body through untouched", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<ht"));
        controller.enqueue(new TextEncoder().encode("ml/>"));
        controller.close();
      },
    });
    const out = withLocaleCookies(new Response(stream), {
      locale: undefined,
      setCookies: [`${CHECKED}; path=/`],
    });
    expect(await out.text()).toBe("<html/>");
  });

  it("returns the same response when there is nothing to set", () => {
    const original = new Response("x");
    expect(
      withLocaleCookies(original, { locale: undefined, setCookies: [] }),
    ).toBe(original);
  });
});
