import { describe, expect, it } from "vitest";
import { isAllowedPdfUrl } from "./pdf-url";

describe("isAllowedPdfUrl", () => {
  it("accepts an https public URL", () => {
    const r = isAllowedPdfUrl("https://arxiv.org/pdf/2301.00001");
    expect(r.ok).toBe(true);
  });

  it("accepts an https URL without a .pdf suffix", () => {
    expect(isAllowedPdfUrl("https://openreview.net/pdf?id=abc").ok).toBe(true);
  });

  it("rejects non-https", () => {
    expect(isAllowedPdfUrl("http://example.com/a.pdf").ok).toBe(false);
  });

  it("rejects an unparseable string", () => {
    expect(isAllowedPdfUrl("not a url").ok).toBe(false);
  });

  it("rejects localhost and loopback", () => {
    expect(isAllowedPdfUrl("https://localhost/a.pdf").ok).toBe(false);
    expect(isAllowedPdfUrl("https://127.0.0.1/a.pdf").ok).toBe(false);
    expect(isAllowedPdfUrl("https://[::1]/a.pdf").ok).toBe(false);
  });

  it("rejects private IPv4 ranges", () => {
    expect(isAllowedPdfUrl("https://10.0.0.5/a.pdf").ok).toBe(false);
    expect(isAllowedPdfUrl("https://192.168.1.1/a.pdf").ok).toBe(false);
    expect(isAllowedPdfUrl("https://172.16.0.1/a.pdf").ok).toBe(false);
    expect(isAllowedPdfUrl("https://172.31.255.255/a.pdf").ok).toBe(false);
  });

  it("rejects the cloud metadata address", () => {
    expect(isAllowedPdfUrl("https://169.254.169.254/latest/meta-data").ok).toBe(
      false,
    );
  });

  it("does not over-block public IPs just outside private ranges", () => {
    expect(isAllowedPdfUrl("https://172.15.0.1/a.pdf").ok).toBe(true);
    expect(isAllowedPdfUrl("https://172.32.0.1/a.pdf").ok).toBe(true);
  });

  it("does not over-block public domains starting with fc/fd", () => {
    expect(isAllowedPdfUrl("https://fdrive.com/a.pdf").ok).toBe(true);
    expect(isAllowedPdfUrl("https://fca.example.com/a.pdf").ok).toBe(true);
  });

  it("rejects IPv6 unique-local (fc00::/7) and 0.0.0.0", () => {
    expect(isAllowedPdfUrl("https://[fc00::1]/a.pdf").ok).toBe(false);
    expect(isAllowedPdfUrl("https://0.0.0.0/a.pdf").ok).toBe(false);
    expect(isAllowedPdfUrl("https://foo.localhost/a.pdf").ok).toBe(false);
  });

  it("reports the reason on rejection", () => {
    expect(isAllowedPdfUrl("not a url")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(isAllowedPdfUrl("http://example.com/a.pdf")).toEqual({
      ok: false,
      reason: "protocol",
    });
    expect(isAllowedPdfUrl("https://10.0.0.5/a.pdf")).toEqual({
      ok: false,
      reason: "host",
    });
  });
});
