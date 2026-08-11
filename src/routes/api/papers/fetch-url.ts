import { createFileRoute } from "@tanstack/react-router";
import { auth } from "#/lib/auth";
import { isPdfBuffer } from "#/lib/pdf-bytes";
import {
  isAllowedPdfUrl,
  PDF_FETCH_HEADERS,
  pdfFetchErrorCode,
  pdfFilenameFromUrl,
} from "#/lib/pdf-url";

/**
 * Server-side PDF download for the "import from link" flow in the paper upload
 * dialog.
 *
 * Why server-side: the browser cannot fetch an arbitrary third-party PDF —
 * cross-origin requests are blocked by CORS. The Worker downloads the bytes and
 * hands them back; the browser then reuses the existing upload path
 * (POST /api/papers/upload → paper.create).
 *
 * This route does NOT touch MinerU or R2 — it only downloads and validates.
 */

const MAX_PDF_BYTES = 100 * 1024 * 1024; // mirrors /api/papers/upload
const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

/**
 * `error` is a STABLE CODE (not a human string) — the client maps it to a
 * localised message (see URL_IMPORT_ERROR in components/papers/upload-dialog.tsx).
 * Codes:
 * bad_url | unauthorized | blocked | not_pdf | too_large | timeout | fetch_failed
 */
class FetchUrlError extends Error {
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.status = status;
  }
}

function jsonError(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Follow redirects manually, re-validating the host on every hop (anti-SSRF). */
async function fetchFollowingRedirects(
  start: string,
  signal: AbortSignal,
): Promise<Response> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Re-validate the host on every hop, including the initial URL (hop 0) — anti-SSRF.
    const check = isAllowedPdfUrl(current);
    if (!check.ok) {
      throw new FetchUrlError("bad_url", 400);
    }
    const resp = await fetch(current, {
      redirect: "manual",
      signal,
      headers: PDF_FETCH_HEADERS,
    });
    if (resp.status >= 300 && resp.status < 400) {
      await resp.body?.cancel();
      const location = resp.headers.get("location");
      if (!location) {
        throw new FetchUrlError("fetch_failed", 502);
      }
      current = new URL(location, current).toString();
      continue;
    }
    return resp;
  }
  throw new FetchUrlError("fetch_failed", 502);
}

/** Read the body with a hard size cap; aborts mid-stream if exceeded. */
async function readCapped(resp: Response): Promise<Uint8Array> {
  const declared = resp.headers.get("content-length");
  if (declared && Number(declared) > MAX_PDF_BYTES) {
    throw new FetchUrlError("too_large", 413);
  }
  const reader = resp.body?.getReader();
  if (!reader) {
    throw new FetchUrlError("fetch_failed", 502);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_PDF_BYTES) {
      await reader.cancel();
      throw new FetchUrlError("too_large", 413);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function handler({ request }: { request: Request }) {
  // Auth: reuse better-auth server session (review-guest has none → blocked).
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return jsonError("unauthorized", 401);
  }

  let url: string;
  try {
    const body = (await request.json()) as { url?: string };
    url = (body.url ?? "").trim();
  } catch {
    return jsonError("bad_url", 400);
  }

  const check = isAllowedPdfUrl(url);
  if (!check.ok) {
    return jsonError("bad_url", 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetchFollowingRedirects(url, controller.signal);
    // 403/429/503 → almost certainly a bot wall; don't download the challenge body.
    const statusCode = pdfFetchErrorCode(resp.status);
    if (statusCode) {
      await resp.body?.cancel();
      return jsonError(statusCode, 502);
    }
    const buffer = await readCapped(resp);
    if (buffer.byteLength === 0) {
      return jsonError("fetch_failed", 502);
    }
    if (!isPdfBuffer(buffer)) {
      return jsonError("not_pdf", 400);
    }
    const filename = pdfFilenameFromUrl(
      resp.url || url,
      resp.headers.get("content-disposition"),
    );
    return new Response(buffer.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "X-Filename": encodeURIComponent(filename),
      },
    });
  } catch (error) {
    if (error instanceof FetchUrlError) {
      return jsonError(error.message, error.status);
    }
    if (error instanceof Error && error.name === "AbortError") {
      return jsonError("timeout", 504);
    }
    console.error("fetch-url failed:", error);
    return jsonError("fetch_failed", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export const Route = createFileRoute("/api/papers/fetch-url")({
  server: {
    handlers: {
      POST: handler,
    },
  },
});
