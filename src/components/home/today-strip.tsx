import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { ModuleKicker } from "#/components/home/module-kicker";
import { StoryImage } from "#/components/news/story-image";
import {
  assembleTodayCards,
  type HomeEdition,
  type HomePaper,
  type HomeStory,
  type HomeToday,
} from "#/lib/home/today";
import { formatRelative } from "#/lib/relative-time";
import { normalizeLocaleKey, pickTldr } from "#/lib/tldr";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

type LocaleKey = ReturnType<typeof normalizeLocaleKey>;

/**
 * 首页「今日精选」四卡。数据由 loader 直出(SSR 读 D1 / 客户端走 tRPC),
 * 空态一律「整卡不渲染」而不是占位骨架——首页没有加载态,拿不到就不该出现。
 */
export function TodayStrip({ today }: { today: HomeToday | null }) {
  if (!today) return null;

  const { headline, subStories, latestPaper, galleryPicks } =
    assembleTodayCards(today);
  const locale = getLocale();
  const localeKey = normalizeLocaleKey(locale);

  // story 的标题是四语 Record, pickTldr 全缺时返回 null; 照渲染就是一条没有可读
  // 名字的链接(a11y 与 SEO 双输)。与 news 详情页对缺失译文的处理同源: 取不到标题
  // 就当这条不存在。papers 的 title 是裸 string 列, 不走这条路径。
  const headlineTitle = headline ? pickTldr(headline.title, localeKey) : null;
  const namedSubStories = subStories.flatMap((story) => {
    const title = pickTldr(story.title, localeKey);
    return title ? [{ shortId: story.shortId, title }] : [];
  });

  // 资讯、论文、合刊三条线全空 = 站点没有任何可展示的内容, 整区让位给静态叙事区
  if (!headlineTitle && !latestPaper && !today.edition) return null;

  return (
    <section className="px-4 pt-8 sm:px-6 sm:pt-10">
      <div className="page-wrap">
        <div className="stagger-in grid gap-3 md:grid-cols-[1.5fr_1fr_1fr]">
          {headline && headlineTitle ? (
            <HeadlineCard
              headline={headline}
              title={headlineTitle}
              subStories={namedSubStories}
              now={today.now}
              locale={locale}
            />
          ) : null}
          {/* 周刊卡是常态形态; 首期合刊发布前(零 published 期)回退到画廊精选卡,
              否则报头下面会缺掉一整格。两套数据都由 loader 一次取回, 不额外往返。 */}
          {today.edition ? (
            <WeeklyEditionCard
              edition={today.edition}
              localeKey={localeKey}
              locale={locale}
            />
          ) : galleryPicks.length > 0 ? (
            <GalleryPicksCard picks={galleryPicks} localeKey={localeKey} />
          ) : null}
          {latestPaper ? (
            <LatestPaperCard paper={latestPaper} localeKey={localeKey} />
          ) : null}
          <AssistantCard />
        </div>
      </div>
    </section>
  );
}

function CardShell({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <article
      className={`flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4 shadow-[0_2px_12px_rgba(45,42,36,0.05)] sm:p-5 ${className ?? ""}`}
    >
      {children}
    </article>
  );
}

/** 卡内「查看全部」尾链:统一的 11px 棕色小字 + 箭头微位移。 */
function MoreLink({
  to,
  children,
}: {
  to: "/news" | "/gallery";
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group mt-3 inline-flex items-center gap-1 self-start text-[11px] font-semibold text-[var(--academic-brown)] no-underline transition-colors hover:text-[var(--academic-brown-deep)]"
    >
      {children}
      <ArrowRight
        className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
        strokeWidth={1.25}
      />
    </Link>
  );
}

function HeadlineCard({
  headline,
  title,
  subStories,
  now,
  locale,
}: {
  headline: HomeStory;
  /** 已在 TodayStrip 侧取好并确认非空的当前语言标题 */
  title: string;
  /** 已过滤掉无标题项 */
  subStories: Array<{ shortId: string; title: string }>;
  now: number;
  locale: string;
}) {
  const published = new Date(headline.publishedAt);
  // 基准时间取查询侧捕获的 now, 否则 SSR 与 hydration 会算出不同的「x 小时前」
  const timeAgo = formatRelative(headline.publishedAt, now, locale);
  // 非 image 类型由 StoryImage 内部一并挡掉, 这里不必再过滤一遍
  const leadImage = headline.leadImage;

  return (
    <CardShell className="md:row-span-2">
      <ModuleKicker as="h2" color="var(--sienna)">
        {m.home_kicker_news()}
      </ModuleKicker>

      <Link
        to="/news/$shortId"
        params={{ shortId: headline.shortId }}
        className="group mt-3 block no-underline"
      >
        {leadImage ? (
          // 首屏内容走 eager
          <StoryImage
            media={leadImage}
            eager
            className="mb-3 aspect-video w-full rounded-xl border border-[var(--line)] object-cover"
          />
        ) : null}
        <h3 className="font-serif text-[15px] font-bold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)] sm:text-base">
          {title}
        </h3>
      </Link>

      <p className="mt-1.5 text-[11px] text-[var(--ink-soft)]">
        <time dateTime={published.toISOString()}>{timeAgo}</time>
      </p>

      {subStories.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-[var(--line)] pt-3">
          {subStories.map((story) => (
            <li key={story.shortId}>
              <Link
                to="/news/$shortId"
                params={{ shortId: story.shortId }}
                className="block text-[13px] leading-snug text-[var(--ink)] no-underline transition-colors hover:text-[var(--academic-brown)]"
              >
                <span aria-hidden className="mr-1.5 text-[var(--ink-soft)]">
                  ·
                </span>
                {story.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <MoreLink to="/news">{m.home_more_news()}</MoreLink>
    </CardShell>
  );
}

/**
 * 「画廊周刊 · 本周」卡 —— 合刊刊头的缩略版。
 *
 * 排版刻意与 EditionMasthead 同构(栏眉 → 衬线「本周」→ 周期区间 → 方向数/入选数),
 * 只是小一号: 读者点进 /gallery 后看到的是同一组信息用同一个顺序放大, 卡与落地页
 * 是同一个对象的两个尺寸而不是两种设计。
 *
 * 两条栏目是封面导语, 刻意不各自成链: 这张卡只有一个门(尾链 → 合刊落地页)。给每条
 * 栏目挂一个通往单期页的深链会把「本周共 N 个方向」这个整体框架拆散, 而首页这一排
 * 卡已经有 6 条资讯链接 + 1 条论文链接在抢注意力。
 */
function WeeklyEditionCard({
  edition,
  localeKey,
  locale,
}: {
  edition: HomeEdition;
  localeKey: LocaleKey;
  locale: string;
}) {
  const range = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        // 必须按 UTC 格化(与刊头、页尾往期列表同一个理由): 周期两端是 UTC 的
        // 00:00:00 / 23:59:59, 按本地时区渲染会让东八区读者看到的末日比合刊自己的
        // 永久链接 /gallery/w/2026-08-15 晚一天 —— 同一期出现两个日历, 顺带成为
        // SSR/hydration 文本漂移(#418)的来源。
        timeZone: "UTC",
      }).formatRange(
        new Date(edition.periodStart),
        new Date(edition.periodEnd),
      ),
    [locale, edition.periodStart, edition.periodEnd],
  );

  // 方向名取不到当前语言的译文就整条不出(与上面 namedSubStories 同源的判断):
  // 一条只有标题没有方向署名的栏目在这张卡里读不出是谁的简报。
  const highlights = edition.highlights.flatMap((h) => {
    const name = pickTldr(h.directionName, localeKey);
    return name ? [{ name, title: pickTldr(h.title, localeKey) }] : [];
  });

  return (
    <CardShell className="md:row-span-2">
      <ModuleKicker as="h2" color="var(--olive)">
        {m.home_kicker_gallery()}
      </ModuleKicker>

      <h3 className="mt-3 font-serif text-[15px] font-bold leading-snug text-[var(--ink)] sm:text-base">
        {m.edition_this_week()}
      </h3>
      <p className="mt-1 text-[11px] text-[var(--ink-soft)]">{range}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--ink-soft)]">
        {/* all / partial 的分支必须与刊头同一套判断: 两处若各挑一个键, 卡上写
            「7 个方向」而刊头写「9 个方向 · 本期 7 个有更新」, 读者会以为点错了期 */}
        {edition.directionCount === edition.activeDirectionCount
          ? m.edition_meta_all({
              directions: String(edition.activeDirectionCount),
              picks: String(edition.pickCount),
            })
          : m.edition_meta_partial({
              directions: String(edition.activeDirectionCount),
              updated: String(edition.directionCount),
              picks: String(edition.pickCount),
            })}
      </p>

      {highlights.length > 0 ? (
        <ul className="mt-3 divide-y divide-[var(--line)] border-t border-[var(--line)]">
          {highlights.map((h) => (
            <li key={h.name} className="py-2.5 last:pb-0">
              <p className="text-[11px] font-semibold text-[var(--ink-soft)]">
                {h.name}
              </p>
              {/* 期标题缺译文时只留方向名: 那仍然是一条真信息(这个方向本期有更新) */}
              {h.title ? (
                <p className="mt-0.5 line-clamp-2 font-serif text-[13.5px] font-semibold leading-snug text-[var(--ink)]">
                  {h.title}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <MoreLink to="/gallery">{m.home_more_gallery()}</MoreLink>
    </CardShell>
  );
}

function GalleryPicksCard({
  picks,
  localeKey,
}: {
  picks: HomePaper[];
  localeKey: LocaleKey;
}) {
  return (
    <CardShell className="md:row-span-2">
      {/* 栏眉不能用 home_kicker_gallery(「方向简报」): 这张卡列的是三篇论文而不是
          简报, 那个键已经归 WeeklyEditionCard。同一个模块槽位、两种内容、两个名字。 */}
      <ModuleKicker as="h2" color="var(--olive)">
        {m.home_kicker_gallery_picks()}
      </ModuleKicker>

      <ul className="mt-3 divide-y divide-[var(--line)]">
        {picks.map((paper) => {
          const tldr = pickTldr(paper.tldr, localeKey);
          return (
            <li key={paper.shortId} className="py-2.5 first:pt-0 last:pb-0">
              <Link
                to="/p/$shortId"
                params={{ shortId: paper.shortId }}
                className="group block no-underline"
              >
                <h3 className="line-clamp-2 font-serif text-[13.5px] font-semibold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)]">
                  {paper.title}
                </h3>
                {tldr ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--ink-soft)]">
                    {tldr}
                  </p>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <MoreLink to="/gallery">{m.home_more_gallery()}</MoreLink>
    </CardShell>
  );
}

function LatestPaperCard({
  paper,
  localeKey,
}: {
  paper: HomePaper;
  localeKey: LocaleKey;
}) {
  const tldr = pickTldr(paper.tldr, localeKey);

  return (
    <CardShell>
      {/* 栏眉必须保持「最新论文」这个精确口径: 这张卡渲染的是 papers[0] —— 最近入库
          的一篇公开论文, 既没有按周取范围也没有编辑挑选。周刊重构期间曾把它换成
          「本周推荐论文 / This week's picks」, 那是在说谎(实现期已撤回并写进 spec)。
          要用那种措辞, 得先把数据源换成本期入选。 */}
      <ModuleKicker as="h2" color="var(--academic-brown)">
        {m.home_kicker_paper()}
      </ModuleKicker>

      <Link
        to="/p/$shortId"
        params={{ shortId: paper.shortId }}
        className="group mt-3 flex gap-3 no-underline"
      >
        {paper.hasImage ? (
          // 白板图标题在左上角, object-top 保证缩到 80x56 时还认得出是哪篇
          <img
            src={`/p/${paper.shortId}/image`}
            alt=""
            loading="lazy"
            className="h-14 w-20 shrink-0 rounded-lg border border-[var(--line)] bg-[var(--parchment-warm)] object-cover object-top"
          />
        ) : null}
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-serif text-[13.5px] font-semibold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)]">
            {paper.title}
          </h3>
          {tldr ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--ink-soft)]">
              {tldr}
            </p>
          ) : null}
        </div>
      </Link>
    </CardShell>
  );
}

/** 工具卡:没有当日数据可放,给一句示例问题 + 输入框形状的 affordance。 */
function AssistantCard() {
  return (
    <CardShell className="transition-colors hover:border-[color-mix(in_srgb,var(--academic-brown)_40%,transparent)]">
      <ModuleKicker as="h2" color="var(--ink-soft)">
        {m.home_kicker_assistant()}
      </ModuleKicker>

      <Link to="/assistant" className="mt-3 block no-underline">
        <p className="font-serif text-[13.5px] leading-relaxed text-[var(--ink)]">
          {m.home_assistant_sample()}
        </p>
        <span className="mt-2.5 block truncate rounded-full border border-[var(--line)] bg-[var(--parchment)] px-3 py-1.5 text-[11px] text-[var(--ink-soft)]">
          {m.home_assistant_hint()}
        </span>
      </Link>
    </CardShell>
  );
}
