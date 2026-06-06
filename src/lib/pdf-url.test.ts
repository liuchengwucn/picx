import { describe, expect, it } from "vitest";
import {
  isAllowedPdfUrl,
  PDF_FETCH_HEADERS,
  pdfFetchErrorCode,
  pdfFilenameFromUrl,
} from "./pdf-url";

describe("PDF_FETCH_HEADERS", () => {
  // Regression guard: workerd's fetch sends NO User-Agent by default, which
  // trips Cloudflare-fronted hosts' bot management — they answer with a 403
  // "Just a moment…" challenge page instead of the PDF, surfacing to the user
  // as "Couldn't fetch that URL". A browser-like UA makes them serve the file.
  it("sends a non-empty, browser-like User-Agent", () => {
    expect(PDF_FETCH_HEADERS["User-Agent"]).toMatch(/Mozilla\/5\.0/);
  });
});

describe("pdfFetchErrorCode", () => {
  it("flags bot-wall / rate-limit statuses as blocked", () => {
    expect(pdfFetchErrorCode(403)).toBe("blocked");
    expect(pdfFetchErrorCode(429)).toBe("blocked");
    expect(pdfFetchErrorCode(503)).toBe("blocked");
  });

  it("flags other non-2xx as a generic fetch failure", () => {
    expect(pdfFetchErrorCode(404)).toBe("fetch_failed");
    expect(pdfFetchErrorCode(500)).toBe("fetch_failed");
    expect(pdfFetchErrorCode(302)).toBe("fetch_failed");
  });

  it("returns null for 2xx so the body gets inspected", () => {
    expect(pdfFetchErrorCode(200)).toBeNull();
    expect(pdfFetchErrorCode(206)).toBeNull();
  });
});

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

  it("rejects IPv4-mapped IPv6 (::ffff:) reaching private hosts", () => {
    expect(isAllowedPdfUrl("https://[::ffff:127.0.0.1]/a.pdf").ok).toBe(false);
    expect(isAllowedPdfUrl("https://[::ffff:169.254.169.254]/x").ok).toBe(
      false,
    );
  });

  it("rejects IPv6 link-local (fe80::/10)", () => {
    expect(isAllowedPdfUrl("https://[fe80::1]/a.pdf").ok).toBe(false);
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

describe("pdfFilenameFromUrl", () => {
  it("prefers a Content-Disposition filename", () => {
    expect(
      pdfFilenameFromUrl(
        "https://x.com/dl",
        'attachment; filename="paper.pdf"',
      ),
    ).toBe("paper.pdf");
  });

  it("falls back to the URL's last path segment", () => {
    expect(pdfFilenameFromUrl("https://x.com/files/report.pdf")).toBe(
      "report.pdf",
    );
  });

  it("adds a .pdf suffix when the segment has none", () => {
    expect(pdfFilenameFromUrl("https://arxiv.org/pdf/2301.00001")).toBe(
      "2301.00001.pdf",
    );
  });

  it("ignores the query string", () => {
    expect(pdfFilenameFromUrl("https://x.com/download?id=5")).toBe(
      "download.pdf",
    );
  });

  it("falls back to document.pdf for a root URL", () => {
    expect(pdfFilenameFromUrl("https://x.com/")).toBe("document.pdf");
  });
});
