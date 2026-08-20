import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { ModuleKicker } from "#/components/home/module-kicker";
import { StoryImage } from "#/components/news/story-image";
import { SelfHidingImage } from "#/components/self-hiding-image";
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

  const {
    headline,
    subStories,
    edition,
    latestPaper,
    relatedPapers,
    galleryPicks,
  } = assembleTodayCards(today);
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
  if (!headlineTitle && !latestPaper && !edition) return null;

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
          {edition ? (
            <WeeklyEditionCard
              edition={edition}
              localeKey={localeKey}
              locale={locale}
            />
          ) : galleryPicks.length > 0 ? (
            <GalleryPicksCard picks={galleryPicks} localeKey={localeKey} />
          ) : null}
          {latestPaper ? (
            <LatestPaperCard
              paper={latestPaper}
              related={relatedPapers}
              localeKey={localeKey}
            />
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

/**
 * 卡内「查看全部」尾链:统一的 11px 棕色小字 + 箭头微位移,并钉在卡底
 * (要求父容器 flex-col —— CardShell 已经是)。余量为 0 时 pt-3 与原来的 mt-3 等价,
 * 所以不需要给调用方留开关: 三张卡的尾链本来就该长一个样、待在同一个位置。
 */
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
      className="group mt-auto inline-flex items-center gap-1 self-start pt-3 text-[11px] font-semibold text-[var(--academic-brown)] no-underline transition-colors hover:text-[var(--academic-brown-deep)]"
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
        // 弹性件是里面那张图, 所以钉在 :has 上而不是 leadImage 上: SelfHidingImage 会在
        // hydration 时把加载失败的 img 整个卸掉(news-cron 的 fail-open 会刻意存下探活
        // 失败的图), 那一刻这块必须立刻停止吃余量, 否则余量会变成标题与时间戳之间的
        // 一道空白 —— 而且 Link 吃光后 MoreLink 的 mt-auto 算出来是 0, 兜底接不住。
        className="group mt-3 flex flex-col no-underline has-[>img]:grow"
      >
        {leadImage ? (
          // 首屏内容走 eager。grow shrink-0 而不是 flex-1: flex-basis:0% 会让这张图
          // 在单列(md 以下, 无剩余空间)塌成一条线。
          <StoryImage
            media={leadImage}
            eager
            className="mb-3 aspect-video w-full shrink-0 grow rounded-xl border border-[var(--line)] object-cover"
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

  // 「本期还有」只列名字。与 highlights 同源的处理: 取不到当前语言译文的方向直接跳过。
  const otherNames = edition.otherDirectionNames.flatMap((n) => {
    const name = pickTldr(n, localeKey);
    return name ? [name] : [];
  });

  return (
    <CardShell className="md:row-span-2">
      {/* 栏眉放刊物名(与 edition_kicker 同值), 不放内容名词: 这张卡是刊头的缩小版,
          栏眉位置对应的就是刊头上那行刊名。曾经这里写「方向简报」, 于是卡说「方向简报」、
          点进去刊头又说「画廊周刊」—— 一个目的地两个称呼。界线是: **目的地名称统一,
          内容描述自由**(首页叙述区的 home_cta_gallery 仍是「浏览方向简报」, 那句描述的
          是内容不是目的地)。导航标签 nav_gallery 是例外, 它为排版单独缩成了「周刊」,
          理由见 Header.tsx。 */}
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

      {otherNames.length > 0 ? (
        <div className="mt-3 border-t border-[var(--line)] pt-2.5">
          <p className="text-[11px] font-semibold text-[var(--ink-soft)]">
            {m.home_edition_more()}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-soft)]">
            {otherNames.join(" · ")}
          </p>
        </div>
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
  related,
  localeKey,
}: {
  paper: HomePaper;
  /** 底座上的次要论文, ≤2; 有合刊时才非空(见 assembleTodayCards) */
  related: HomePaper[];
  localeKey: LocaleKey;
}) {
  const tldr = pickTldr(paper.tldr, localeKey);

  return (
    <CardShell>
      {/* 栏眉必须保持「最新论文」这个精确口径: 这张卡渲染的是 papers[0] —— 最近入库的
          一篇公开论文(有合刊时底座再带上随后两篇), 既没有按周取范围也没有编辑挑选。
          周刊重构期间曾把它换成
          「本周推荐论文 / This week's picks」, 那是在说谎(实现期已撤回并写进 spec)。
          要用那种措辞, 得先把数据源换成本期入选。 */}
      <ModuleKicker as="h2" color="var(--academic-brown)">
        {m.home_kicker_paper()}
      </ModuleKicker>

      {/* 弹性件是里面那张图, 所以钉在 :has 上而不是 paper.hasImage 上: SelfHidingImage
          会在图加载失败时把 img 整个卸掉(DB 的 whiteboardKey 只保证记录存在, 不保证 R2
          对象还在), 那一刻这块必须立刻停止吃余量, 否则余量会变成标题与底座之间的一道
          空白 —— 而且 Link 吃光后下面列表的 mt-auto 算出来是 0, 兜底接不住。 */}
      <Link
        to="/p/$shortId"
        params={{ shortId: paper.shortId }}
        className="group mt-3 mb-3 flex flex-col no-underline has-[>img]:grow"
      >
        {paper.hasImage ? (
          // 白板图标题在左上角, object-top 保证被裁切时还认得出是哪篇。
          // grow shrink-0 而不是 flex-1: flex-basis:0% 会让这张图在单列(md 以下,
          // 无剩余空间)塌成一条线。这张图在首屏但不是 LCP(那是报头 logo), 保持 lazy。
          <SelfHidingImage
            src={`/p/${paper.shortId}/image`}
            className="mb-3 aspect-video w-full shrink-0 grow rounded-xl border border-[var(--line)] bg-[var(--parchment-warm)] object-cover object-top"
          />
        ) : null}
        <h3 className="line-clamp-2 font-serif text-[13.5px] font-semibold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)]">
          {paper.title}
        </h3>
        {tldr ? (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--ink-soft)]">
            {tldr}
          </p>
        ) : null}
      </Link>

      {/* 固定底座: 排版与头条卡的次条列表同构。mt-auto 无条件写: 有图时图先吃光余量,
          按 flexbox 的顺序(先分配弹性长度, 再吃 auto 外边距)这里自动失效; 无图时它接手
          钉底, 让余量落在主论文与底座之间而不是卡片底部。
          细线上方那 12px 间距来自上面 Link 的 mb-3, 不是这里: auto 外边距只吸收**正的**
          剩余空间, 余量为 0 时(移动端单列全程、桌面图已吃光余量)它解析成 0, 撑不出任何
          距离, 细线会贴上 tldr 的行盒。普通外边距则在算剩余空间时就先被减掉, 两种情形
          下都稳定。pt-3 在边框下方, 管的是列表项与细线的距离, 换不到这个位置。 */}
      {related.length > 0 ? (
        <ul className="mt-auto space-y-2 border-t border-[var(--line)] pt-3">
          {related.map((p) => (
            <li key={p.shortId}>
              <Link
                to="/p/$shortId"
                params={{ shortId: p.shortId }}
                className="block text-[13px] leading-snug text-[var(--ink)] no-underline transition-colors hover:text-[var(--academic-brown)]"
              >
                <span aria-hidden className="mr-1.5 text-[var(--ink-soft)]">
                  ·
                </span>
                {p.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
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
