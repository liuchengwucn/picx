/**
 * URL safety + filename parsing for the Reader "import from URL" feature.
 * Pure and framework-free so it can be unit-tested and shared by the route
 * handler and the browser-side input validation.
 */

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: "invalid" | "protocol" | "host" };

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
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) {
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
