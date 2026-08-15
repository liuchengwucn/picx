import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  isNotFound,
  Link,
  notFound,
} from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowLeft, Clock, ExternalLink, MessageSquare } from "lucide-react";
import { ScoreBadge } from "#/components/news/score-badge";
import { StoryImage } from "#/components/news/story-image";
import { Badge } from "#/components/ui/badge";
import { Skeleton } from "#/components/ui/skeleton";
import { useTRPC } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { useDebugScores } from "#/lib/news/use-debug-scores";
import { formatRelative } from "#/lib/relative-time";
import { SITE_URL } from "#/lib/site-url";
import { normalizeLocaleKey, pickTldr } from "#/lib/tldr";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

interface AppEnvBindings {
  DB: D1Database;
}

// SSR 预取数据必须与 news.byShortId 的输出形状完全一致，才能作为 react-query 的
// initialData 注入。
type ByShortIdOutput = inferRouterOutputs<TRPCRouter>["news"]["byShortId"];
// loader 数据会经过可序列化类型变换（unknown 收窄为 {}），extra 的 unknown
// 必须先固定成可序列化形状，SSR/客户端两个分支才能合一。
type SerializableByShortId = Omit<ByShortIdOutput, "items"> & {
  items: Array<
    Omit<ByShortIdOutput["items"][number], "extra"> & {
      extra: Record<string, NonNullable<unknown>> | null;
    }
  >;
};

export const Route = createFileRoute("/news/$shortId")({
  component: NewsStoryPage,
  // 客户端导航时 NOT_FOUND 会从 loader 抛出（SSR 分支查不到则 throw notFound() 返回 404）
  errorComponent: StoryNotFound,
  notFoundComponent: StoryNotFound,
  loader: async ({ context, params }) => {
    if (import.meta.env.SSR) {
      // SSR: 直接读 D1，让爬虫拿到有内容的首个 HTML 响应而不是骨架屏。
      try {
        const { env } = await import("cloudflare:workers");
        const { drizzle } = await import("drizzle-orm/d1");
        const { and, eq, inArray, sql } = await import("drizzle-orm");
        const { newsItems, newsSources, newsStories } = await import(
          "#/db/schema"
        );
        const appEnv = env as typeof env & AppEnvBindings;
        const db = drizzle(appEnv.DB);

        // 显式投影（不带 centroid blob）；字面量谓词才能命中 partial index
        const [story] = await db
          .select({
            id: newsStories.id,
            shortId: newsStories.shortId,
            title: newsStories.title,
            summary: newsStories.summary,
            tags: newsStories.tags,
            signalsSummary: newsStories.signalsSummary,
            firstSeenAt: newsStories.firstSeenAt,
            earliestPublishedAt: newsStories.earliestPublishedAt,
            lastActivityAt: newsStories.lastActivityAt,
            keyFacts: newsStories.keyFacts,
            related: newsStories.related,
          })
          .from(newsStories)
          .where(
            and(
              eq(newsStories.shortId, params.shortId),
              sql`${newsStories.status} != 'hidden'`,
            ),
          )
          .limit(1);

        // 查不到故事：抛 notFound() 让 SSR 返回真正的 404 状态码（而非 200 骨架屏）
        if (!story) throw notFound();

        // items 与相关资讯查询都只依赖 story（不互相依赖），并发发起省一个串行 D1 往返
        const relatedIds = story.related ?? [];
        const [items, relatedRows] = await Promise.all([
          db
            .select({
              url: newsItems.url,
              title: newsItems.title,
              excerpt: newsItems.excerpt,
              author: newsItems.author,
              publishedAt: newsItems.publishedAt,
              signals: newsItems.signals,
              media: newsItems.media,
              extra: newsItems.extra,
              // 分数始终下发，是否显示由前端 debug 开关决定（与 news.byShortId 一致）
              relevanceScore: newsItems.relevanceScore,
              sourceName: newsSources.name,
              sourceType: newsSources.type,
            })
            .from(newsItems)
            .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
            .where(eq(newsItems.storyId, story.id))
            .orderBy(newsItems.publishedAt),
          relatedIds.length > 0
            ? db
                .select({
                  shortId: newsStories.shortId,
                  title: newsStories.title,
                  firstSeenAt: newsStories.firstSeenAt,
                  earliestPublishedAt: newsStories.earliestPublishedAt,
                })
                .from(newsStories)
                .where(
                  and(
                    inArray(newsStories.shortId, relatedIds),
                    sql`${newsStories.status} != 'hidden' AND ${newsStories.dirty} = 0`,
                  ),
                )
            : Promise.resolve([]),
        ]);
        const related = relatedIds.flatMap((sid) => {
          const row = relatedRows.find((r) => r.shortId === sid);
          return row ? [row] : [];
        });

        const ssrData = {
          shortId: story.shortId,
          title: story.title,
          summary: story.summary,
          tags: story.tags ?? [],
          signalsSummary: story.signalsSummary,
          firstSeenAt: story.firstSeenAt,
          earliestPublishedAt: story.earliestPublishedAt,
          lastActivityAt: story.lastActivityAt,
          keyFacts: story.keyFacts ?? null,
          related,
          items,
        } satisfies ByShortIdOutput as SerializableByShortId;
        return { ssrData };
      } catch (error) {
        // notFound 必须穿透；其余错误（DB 不可用等）降级为 CSR 兜底
        if (isNotFound(error)) throw error;
        return { ssrData: null };
      }
    }

    const ssrData = (await context.queryClient.ensureQueryData(
      context.trpc.news.byShortId.queryOptions({ shortId: params.shortId }),
    )) as SerializableByShortId;
    return { ssrData };
  },
  head: ({ loaderData }) => {
    const story = loaderData?.ssrData;
    if (!story) {
      return { meta: [{ title: "PicX - AI News" }] };
    }

    const localeKey = normalizeLocaleKey(getLocale());
    const localizedTitle = pickTldr(story.title, localeKey) ?? "";
    const localizedSummary = pickTldr(story.summary, localeKey) ?? "";
    const title = `${localizedTitle} | PicX AI News`;
    const description = localizedSummary.slice(0, 160);
    const url = `${SITE_URL}/news/${story.shortId}`;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          // 防止 </script> 逃逸：children 经 dangerouslySetInnerHTML 注入，必须转义 <
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "NewsArticle",
            headline: story.title.en ?? localizedTitle,
            description: story.summary.en ?? description,
            url,
            mainEntityOfPage: url,
            datePublished: new Date(
              story.earliestPublishedAt ?? story.firstSeenAt,
            ).toISOString(),
            dateModified: new Date(story.lastActivityAt).toISOString(),
            publisher: {
              "@type": "Organization",
              name: "PicX",
              url: SITE_URL,
            },
          }).replace(/</g, "\\u003c"),
        },
      ],
    };
  },
});

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function NewsStoryPage() {
  const { shortId } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const trpc = useTRPC();
  const showScores = useDebugScores();

  const { data, isLoading, error } = useQuery({
    ...trpc.news.byShortId.queryOptions({ shortId }),
    initialData: loaderData?.ssrData ?? undefined,
    staleTime: loaderData?.ssrData ? 30_000 : undefined,
  });

  if (isLoading && !data) return <StoryDetailSkeleton />;
  if (error || !data) return <StoryNotFound />;

  const localeKey = normalizeLocaleKey(getLocale());
  const locale = getLocale();
  const now = Date.now();
  const title = pickTldr(data.title, localeKey) ?? "";
  const summary = pickTldr(data.summary, localeKey) ?? "";
  const hn = data.signalsSummary?.hn;
  const timeAgo = formatRelative(
    new Date(data.earliestPublishedAt ?? data.firstSeenAt).getTime(),
    now,
    locale,
  );
  const facts = (() => {
    // keyFacts 按 locale 取；空数组也回退 en（?? 对空数组不回退，须按 length 判断）
    const localeFacts = data.keyFacts?.[localeKey];
    return (localeFacts?.length ? localeFacts : data.keyFacts?.en) ?? [];
  })();
  // 相关资讯标题按 locale 取；取不到（四语均缺失）就不渲染该行，避免无名链接
  const related = (data.related ?? []).flatMap((rel) => {
    const displayTitle = pickTldr(rel.title, localeKey);
    return displayTitle ? [{ ...rel, displayTitle }] : [];
  });
  const hasAside = facts.length > 0 || related.length > 0;

  return (
    <main className="min-h-dvh bg-[var(--bg)] py-8">
      <div className={hasAside ? "page-wrap max-w-5xl" : "page-wrap max-w-3xl"}>
        <div className="rise-in">
          <Link
            to="/news"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--ink-soft)] no-underline transition-colors hover:text-[var(--academic-brown)]"
          >
            <ArrowLeft className="h-4 w-4" />
            {m.news_back()}
          </Link>

          <article className="mt-6">
            <header>
              <h1 className="font-serif text-3xl font-bold leading-tight text-[var(--ink)]">
                {title}
              </h1>

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[var(--ink-soft)]">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <time>{timeAgo}</time>
                </span>
                {hn && (
                  <a
                    href={hn.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 no-underline transition-colors hover:border-[var(--academic-brown)] hover:text-[var(--academic-brown)]"
                  >
                    <MessageSquare className="h-3 w-3" />
                    {m.news_hn_points({ points: hn.points.toString() })}
                    {" · "}
                    {m.news_hn_comments({ count: hn.comments.toString() })}
                  </a>
                )}
                {data.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="border-[var(--line)] px-2 py-0.5 text-[11px] font-normal text-[var(--ink-soft)]"
                  >
                    #{tag}
                  </Badge>
                ))}
              </div>
            </header>

            <div
              className={
                hasAside
                  ? "mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-x-10"
                  : "mt-5"
              }
            >
              {summary && (
                <p className="text-base leading-relaxed text-[var(--ink)] lg:col-start-1 lg:row-start-1">
                  {summary}
                </p>
              )}

              {hasAside && (
                <aside className="mt-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
                  <div className="space-y-6 lg:sticky lg:top-24">
                    {facts.length > 0 && (
                      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3.5">
                        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--academic-brown)]">
                          {m.news_key_facts()}
                        </h2>
                        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-[var(--ink)]">
                          {facts.map((fact) => (
                            <li key={fact}>{fact}</li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {related.length > 0 && (
                      <section>
                        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--academic-brown)]">
                          {m.news_related()}
                        </h2>
                        <ul className="mt-2 space-y-2.5">
                          {related.map((rel) => (
                            <li key={rel.shortId}>
                              <Link
                                to="/news/$shortId"
                                params={{ shortId: rel.shortId }}
                                className="font-serif text-sm font-semibold leading-snug text-[var(--ink)] no-underline transition-colors hover:text-[var(--academic-brown)]"
                              >
                                {rel.displayTitle}
                              </Link>
                              <div className="mt-0.5 text-xs text-[var(--ink-soft)]">
                                {formatRelative(
                                  new Date(
                                    rel.earliestPublishedAt ?? rel.firstSeenAt,
                                  ).getTime(),
                                  now,
                                  locale,
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </div>
                </aside>
              )}

              {/* 报道时间线:按发布时间正序,首条(故事源头)用空心环点强调 */}
              <section className="mt-10 lg:col-start-1 lg:row-start-2">
                <h2 className="font-serif text-xl font-semibold text-[var(--ink)]">
                  {m.news_timeline()}
                </h2>
                <ol className="mt-5 border-l border-[var(--line)] pl-6">
                  {data.items.map((item, index) => {
                    const domain = hostnameOf(item.url);
                    const image = item.media?.find(
                      (media) => media.type === "image",
                    );
                    const itemTimeAgo = formatRelative(
                      new Date(item.publishedAt).getTime(),
                      now,
                      locale,
                    );
                    const hnUrl =
                      typeof item.extra?.hnUrl === "string"
                        ? item.extra.hnUrl
                        : null;
                    const showHnLink = hnUrl !== null && hnUrl !== item.url;
                    return (
                      <li key={item.url} className="relative pb-8 last:pb-0">
                        <span
                          aria-hidden="true"
                          className={`absolute top-1.5 -left-[30px] h-2.5 w-2.5 rounded-full ${
                            index === 0
                              ? "border-2 border-[var(--academic-brown)] bg-[var(--bg)]"
                              : "bg-[var(--academic-brown)]"
                          }`}
                        />
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--ink-soft)]">
                          {domain && (
                            <img
                              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                              alt=""
                              loading="lazy"
                              className="h-4 w-4 rounded-full bg-[var(--bg)]"
                            />
                          )}
                          <span className="font-medium text-[var(--ink)]">
                            {item.sourceName}
                          </span>
                          {item.author && <span>{item.author}</span>}
                          <time>{itemTimeAgo}</time>
                          {showScores && item.relevanceScore != null && (
                            <ScoreBadge min={item.relevanceScore} />
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-start gap-x-3 gap-y-1">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="group inline-flex items-start gap-1.5 no-underline"
                          >
                            <span className="font-serif text-base font-semibold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)]">
                              {item.title}
                            </span>
                            <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--ink-soft)] transition-colors group-hover:text-[var(--academic-brown)]" />
                          </a>
                          {showHnLink && (
                            <a
                              href={hnUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="group inline-flex items-center gap-1 self-start text-xs text-[var(--ink-soft)] no-underline transition-colors hover:text-[var(--academic-brown)]"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              HN
                            </a>
                          )}
                        </div>
                        {item.excerpt && (
                          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-[var(--ink-soft)]">
                            {item.excerpt}
                          </p>
                        )}
                        {image && (
                          <StoryImage
                            media={image}
                            className="mt-3 max-h-64 w-auto rounded-xl border border-[var(--line)] object-cover"
                          />
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            </div>
          </article>
        </div>
      </div>
    </main>
  );
}

function StoryNotFound() {
  return (
    <main className="min-h-dvh bg-[var(--bg)] py-8">
      <div className="page-wrap max-w-3xl">
        <div className="rise-in mx-auto max-w-md py-16 text-center">
          <h1 className="font-serif text-2xl font-bold text-[var(--ink)]">
            404
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            {m.news_not_found()}
          </p>
          <Link
            to="/news"
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-[var(--academic-brown)] no-underline hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            {m.news_back()}
          </Link>
        </div>
      </div>
    </main>
  );
}

function StoryDetailSkeleton() {
  return (
    <main className="min-h-dvh bg-[var(--bg)] py-8">
      <div className="page-wrap max-w-5xl">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-6 h-9 w-4/5" />
        <div className="mt-3 flex gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-x-10">
          <div className="space-y-2 lg:col-start-1 lg:row-start-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="mt-8 hidden lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:block">
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
          <div className="mt-10 lg:col-start-1 lg:row-start-2">
            <Skeleton className="h-6 w-40" />
            <div className="mt-5 space-y-6 border-l border-[var(--line)] pl-6">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
