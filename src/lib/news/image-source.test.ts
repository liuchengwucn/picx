import { describe, expect, it } from "vitest";
import { displayImageUrl, needsImageProxy } from "./image-source";

const QBITAI = "https://i.qbitai.com/2026/08/cover.jpg";

describe("needsImageProxy", () => {
  it("matches hotlink-protected hosts", () => {
    expect(needsImageProxy(QBITAI)).toBe(true);
    expect(
      needsImageProxy("https://image.jiqizhixin.com/uploads/a/b.png"),
    ).toBe(true);
  });
  it("is case-insensitive on host", () => {
    expect(needsImageProxy("https://I.QBITAI.com/x.jpg")).toBe(true);
  });
  it("leaves other hosts alone", () => {
    // 微信图床直连+不带 Referer 才拿得到真图，故意不在白名单里
    expect(needsImageProxy("https://mmbiz.qpic.cn/x/640")).toBe(false);
    expect(needsImageProxy("https://example.com/a.jpg")).toBe(false);
  });
  it("rejects non-https even on whitelisted hosts", () => {
    expect(needsImageProxy("http://i.qbitai.com/x.jpg")).toBe(false);
  });
  it("does not match hosts that merely end with a whitelisted name", () => {
    expect(needsImageProxy("https://evil-i.qbitai.com.attacker.io/x")).toBe(
      false,
    );
  });
  it("treats unparseable input as not proxyable", () => {
    expect(needsImageProxy("")).toBe(false);
    expect(needsImageProxy("not a url")).toBe(false);
    expect(needsImageProxy("//i.qbitai.com/x.jpg")).toBe(false);
  });
});

describe("displayImageUrl", () => {
  it("routes whitelisted images through the proxy", () => {
    expect(displayImageUrl(QBITAI)).toBe(
      `/api/news-image?u=${encodeURIComponent(QBITAI)}`,
    );
  });
  it("escapes query strings so the whole url survives as one param", () => {
    const src = "https://i.qbitai.com/a.jpg?w=800&h=600";
    const proxied = displayImageUrl(src);
    expect(new URL(proxied, "https://picx.dev").searchParams.get("u")).toBe(
      src,
    );
  });
  it("passes non-whitelisted urls through untouched", () => {
    expect(displayImageUrl("https://example.com/a.jpg")).toBe(
      "https://example.com/a.jpg",
    );
    expect(displayImageUrl("not a url")).toBe("not a url");
  });
});
