import { createFileRoute } from "@tanstack/react-router";
import { auth } from "#/lib/auth";
import { isPdfBuffer } from "#/lib/pdf-bytes";
import { isAllowedPdfUrl, pdfFilenameFromUrl } from "#/lib/pdf-url";

/**
 * Server-side PDF download for the Reader "import from URL" flow.
 *
 * Why server-side: the browser cannot fetch an arbitrary third-party PDF —
 * cross-origin requests are blocked by CORS (same reason the browser can't PUT
 * to MinerU's OSS). The Worker downloads the bytes and hands them back; the
 * browser then reuses the existing local-upload path (analyze → trim → upload).
 *
 * This route does NOT touch MinerU — it only downloads and validates.
 */

const MAX_PDF_BYTES = 100 * 1024 * 1024; // mirrors /api/reader/upload
const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

class FetchUrlError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
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
      throw new FetchUrlError("Enter a valid https PDF URL", 400);
    }
    const resp = await fetch(current, { redirect: "manual", signal });
    if (resp.status >= 300 && resp.status < 400) {
      await resp.body?.cancel();
      const location = resp.headers.get("location");
      if (!location) {
        throw new FetchUrlError("Couldn't fetch that URL", 502);
      }
      current = new URL(location, current).toString();
      continue;
    }
    return resp;
  }
  throw new FetchUrlError("Couldn't fetch that URL", 502);
}

/** Read the body with a hard size cap; aborts mid-stream if exceeded. */
async function readCapped(resp: Response): Promise<Uint8Array> {
  const declared = resp.headers.get("content-length");
  if (declared && Number(declared) > MAX_PDF_BYTES) {
    throw new FetchUrlError("File exceeds the 100MB limit", 413);
  }
  const reader = resp.body?.getReader();
  if (!reader) {
    throw new FetchUrlError("Couldn't fetch that URL", 502);
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
      throw new FetchUrlError("File exceeds the 100MB limit", 413);
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
    return jsonError("You must be logged in to import", 401);
  }

  let url: string;
  try {
    const body = (await request.json()) as { url?: string };
    url = (body.url ?? "").trim();
  } catch {
    return jsonError("Enter a valid https PDF URL", 400);
  }

  const check = isAllowedPdfUrl(url);
  if (!check.ok) {
    return jsonError("Enter a valid https PDF URL", 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetchFollowingRedirects(url, controller.signal);
    if (!resp.ok) {
      return jsonError("Couldn't fetch that URL", 502);
    }
    const buffer = await readCapped(resp);
    if (buffer.byteLength === 0) {
      return jsonError("Couldn't fetch that URL", 502);
    }
    if (!isPdfBuffer(buffer)) {
      return jsonError("That URL is not a PDF", 400);
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
      return jsonError("Couldn't fetch that URL", 504);
    }
    console.error("Reader fetch-url failed:", error);
    return jsonError("Couldn't fetch that URL", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export const Route = createFileRoute("/api/reader/fetch-url")({
  server: {
    handlers: {
      POST: handler,
    },
  },
});
