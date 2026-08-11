/**
 * URL safety + filename parsing for the "import from link" upload flow.
 * Pure and framework-free so it can be unit-tested and shared by the route
 * handler and the browser-side input validation.
 */

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: "invalid" | "protocol" | "host" };

/**
 * Request headers for the server-side PDF download.
 *
 * workerd's `fetch()` sends no User-Agent by default. Many PDF hosts sit behind
 * Cloudflare bot management, which answers a UA-less request with a 403
 * "Just a moment…" challenge page instead of the file — the import then reports
 * "Couldn't fetch that URL". A normal browser UA makes those hosts serve the PDF.
 */
export const PDF_FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
};

/**
 * Map a fetched response's HTTP status to a stable error code, or `null` when
 * the body should be downloaded and inspected (2xx). The client localises the
 * code into a message — see URL_IMPORT_ERROR in components/papers/upload-dialog.tsx.
 *
 * 403/429/503 almost always mean a bot wall / rate limit / anti-DDoS interstitial
 * (e.g. Cloudflare's "Just a moment…" page), so we tell the user to download the
 * PDF themselves rather than the misleading generic "couldn't fetch".
 */
export function pdfFetchErrorCode(
  status: number,
): "blocked" | "fetch_failed" | null {
  if (status === 403 || status === 429 || status === 503) {
    return "blocked";
  }
  if (status < 200 || status >= 300) {
    return "fetch_failed";
  }
  return null;
}

const PRIVATE_IPV4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  // IPv6 literals contain a colon; only then check loopback / unique-local.
  if (host.includes(":")) {
    // IPv6: loopback ::1, ULA fc00::/7 (fc/fd), link-local fe80::/10, and
    // IPv4-mapped (::ffff:…) which could otherwise smuggle a private IPv4.
    if (
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80") ||
      host.startsWith("::ffff:")
    ) {
      return true;
    }
  }
  // IPv4 literal → check against private ranges.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return PRIVATE_IPV4.some((re) => re.test(host));
  }
  return false;
}

/** Allow only https URLs pointing at non-private hosts. */
export function isAllowedPdfUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "protocol" };
  }
  let host = url.hostname;
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1); // strip IPv6 brackets
  }
  if (isPrivateHost(host)) {
    return { ok: false, reason: "host" };
  }
  return { ok: true, url };
}

/** Keep a safe, ASCII-ish filename and guarantee a .pdf extension. */
function ensurePdfName(name: string): string {
  const cleaned = name
    .replace(/[/\\?%*:|"<>]/g, "") // strip reserved path chars
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char strip
    .replace(/[\x00-\x1f]/g, "") // strip control chars
    .replace(/\s+/g, "_")
    .slice(0, 120)
    .trim();
  if (!cleaned) {
    return "document.pdf";
  }
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

/** Derive a download filename from Content-Disposition, else the URL path. */
export function pdfFilenameFromUrl(
  finalUrl: string,
  contentDisposition?: string | null,
): string {
  if (contentDisposition) {
    const star = contentDisposition.match(
      /filename\*=(?:UTF-8'')?([^;]+)/i,
    )?.[1];
    const plain = contentDisposition.match(/filename="?([^";]+)"?/i)?.[1];
    const raw = star ?? plain;
    if (raw) {
      try {
        return ensurePdfName(decodeURIComponent(raw.trim()));
      } catch {
        return ensurePdfName(raw.trim());
      }
    }
  }
  try {
    const seg = new URL(finalUrl).pathname.split("/").filter(Boolean).pop();
    if (seg) {
      return ensurePdfName(decodeURIComponent(seg));
    }
  } catch {
    // fall through to default
  }
  return "document.pdf";
}
