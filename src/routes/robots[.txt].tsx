import { createFileRoute } from "@tanstack/react-router";

async function handler({ request }: { request: Request }) {
  const origin = new URL(request.url).origin;

  const content = `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml`;

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: handler,
    },
  },
});
