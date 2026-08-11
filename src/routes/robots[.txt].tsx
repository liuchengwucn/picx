import { createFileRoute } from "@tanstack/react-router";

async function handler({ request }: { request: Request }) {
  const origin = new URL(request.url).origin;

  // Allow: / 与 Disallow: /admin 并存时，/admin/* 命中更长（更具体）的那条规则，
  // 所以 Disallow 生效。管理页本来就有 noindex meta，这里是给那些只读 robots.txt
  // 就不再抓的爬虫补一道，别把管理台喂进索引。
  const content = `User-agent: *
Allow: /
Disallow: /admin

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
