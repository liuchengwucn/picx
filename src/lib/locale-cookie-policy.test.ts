import { describe, expect, it } from "vitest";
import {
  decideRequestLocale,
  isHtmlNavigation,
  LOCALE_CHECKED_COOKIE,
  withLocaleCookies,
} from "#/lib/locale-cookie-policy";

const CHECKED = `${LOCALE_CHECKED_COOKIE}=1`;
const names = (d: ReturnType<typeof decideRequestLocale>) =>
  d.setCookies.map((c) => c.split(";")[0]);

describe("decideRequestLocale", () => {
  it("negotiates and persists on a cookieless first visit", () => {
    const d = decideRequestLocale(null, "zh-CN,zh;q=0.9");
    expect(d.locale).toBe("zh-CN");
    expect(names(d)).toEqual([CHECKED, "PARAGLIDE_LOCALE=zh-CN"]);
  });

  it("only marks the browser when nothing negotiates", () => {
    const d = decideRequestLocale(null, "fr-FR,fr;q=0.8");
    expect(d.locale).toBeUndefined();
    expect(names(d)).toEqual([CHECKED]);
  });

  it("respects a non-en cookie even without the marker", () => {
    const d = decideRequestLocale("PARAGLIDE_LOCALE=zh-TW", "zh-CN");
    expect(d.locale).toBeUndefined();
    expect(names(d)).toEqual([CHECKED]);
  });

  it("resets an unmarked en cookie when the browser prefers another locale", () => {
    const d = decideRequestLocale("_ga=x; PARAGLIDE_LOCALE=en", "ja,en;q=0.5");
    expect(d.locale).toBe("ja");
    expect(names(d)).toEqual([CHECKED, "PARAGLIDE_LOCALE=ja"]);
  });

  it("keeps an unmarked en cookie for English or unsupported browsers", () => {
    expect(
      decideRequestLocale("PARAGLIDE_LOCALE=en", "en-US").locale,
    ).toBeUndefined();
    expect(
      decideRequestLocale("PARAGLIDE_LOCALE=en", "fr").locale,
    ).toBeUndefined();
    expect(
      decideRequestLocale("PARAGLIDE_LOCALE=en", null).locale,
    ).toBeUndefined();
  });

  it("never touches an en cookie once the browser is marked", () => {
    const d = decideRequestLocale(`PARAGLIDE_LOCALE=en; ${CHECKED}`, "zh-CN");
    expect(d.locale).toBeUndefined();
    expect(d.setCookies).toEqual([]);
  });

  it("negotiates when the cookie holds garbage", () => {
    const d = decideRequestLocale(`PARAGLIDE_LOCALE=xx; ${CHECKED}`, "ja");
    expect(d.locale).toBe("ja");
    expect(names(d)).toEqual(["PARAGLIDE_LOCALE=ja"]);
  });
});

describe("isHtmlNavigation", () => {
  it("accepts document fetches and html Accept, rejects api calls", () => {
    expect(
      isHtmlNavigation(
        new Request("https://x/", {
          headers: { "sec-fetch-dest": "document" },
        }),
      ),
    ).toBe(true);
    expect(
      isHtmlNavigation(
        new Request("https://x/", { headers: { accept: "text/html,*/*" } }),
      ),
    ).toBe(true);
    expect(
      isHtmlNavigation(
        new Request("https://x/api/trpc", {
          headers: { accept: "application/json" },
        }),
      ),
    ).toBe(false);
    expect(
      isHtmlNavigation(
        new Request("https://x/", {
          method: "POST",
          headers: { accept: "text/html" },
        }),
      ),
    ).toBe(false);
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

  it("returns the same response when there is nothing to set", () => {
    const original = new Response("x");
    expect(
      withLocaleCookies(original, { locale: undefined, setCookies: [] }),
    ).toBe(original);
  });
});
