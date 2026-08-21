import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { type ReactNode, type Ref, useMemo } from "react";
import { ModuleKicker } from "#/components/home/module-kicker";
import { StoryImage } from "#/components/news/story-image";
import { SelfHidingImage } from "#/components/self-hiding-image";
import { useFitLevel } from "#/hooks/use-fit-level";
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
    return title
      ? [
          {
            shortId: story.shortId,
            title,
            publishedAt: story.publishedAt,
            sourceCount: story.sourceCount,
          },
        ]
      : [];
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
  ref,
  className,
  fitLevel,
  children,
}: {
  /** React 19 的 ref-as-prop; useFitLevel 的 containerRef 直接传进来 */
  ref?: Ref<HTMLElement>;
  className?: string;
  /** 接了 fit-level 的卡把当前档写成 data-fit-level, 验收脚本据此断言「首帧即终值」 */
  fitLevel?: number;
  children: ReactNode;
}) {
  return (
    <article
      ref={ref}
      data-fit-level={fitLevel}
      className={`flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4 shadow-[0_2px_12px_rgba(45,42,36,0.05)] sm:p-5 ${className ?? ""}`}
    >
      {children}
    </article>
  );
}

/**
 * 卡内的余量探针: 高度 = 还没被任何人吃掉的余量, useFitLevel 据此决定要不要升档。
 * 必须放在分级内容之后、尾链之前。MoreLink 的 mt-auto 在它存在时恒为 0
 * (flex 先分配弹性长度, 再吃 auto 外边距), 两者不冲突。
 */
function FitSpacer({ ref }: { ref: Ref<HTMLDivElement> }) {
  return <div ref={ref} className="grow" aria-hidden />;
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

/**
 * 资讯卡的档位: 先加密度(副行), 再逐条加条数。
 *
 * L0 是 SSR 档, 必须与改动前的形态完全一致 —— 无 JS、爬虫、移动端单列都停在这里。
 *
 * **逐条递增而不是 5/6/8 跳着走**: 探测是「升一档 → 溢出就退回」, 跳着走会让退回
 * 后白白空着一条的余量。实测(1440, 头条无配图)次条列表可用约 422px、每条带副行
 * 约 38px —— 8 条正好把每条的空白压到 8px; 而 1024 下每条涨到约 56px, 7 条就溢出,
 * 只能停在 6 条。同一套档位在不同宽度自动落在不同档, 这正是这个机制存在的理由,
 * 别硬编码断点。
 */
const SUB_STORY_TIERS = [
  { count: 5, meta: false },
  { count: 5, meta: true },
  { count: 6, meta: true },
  { count: 7, meta: true },
  { count: 8, meta: true },
] as const;

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
  subStories: Array<{
    shortId: string;
    title: string;
    publishedAt: number;
    sourceCount: number;
  }>;
  now: number;
  locale: string;
}) {
  const published = new Date(headline.publishedAt);
  // 基准时间取查询侧捕获的 now, 否则 SSR 与 hydration 会算出不同的「x 小时前」
  const timeAgo = formatRelative(headline.publishedAt, now, locale);
  // 非 image 类型由 StoryImage 内部一并挡掉, 这里不必再过滤一遍
  const leadImage = headline.leadImage;

  const { level, spacerRef, containerRef } = useFitLevel(
    SUB_STORY_TIERS.length - 1,
  );
  const tier = SUB_STORY_TIERS[level] ?? SUB_STORY_TIERS[0];
  const shownSubStories = subStories.slice(0, tier.count);

  return (
    <CardShell ref={containerRef} fitLevel={level} className="md:row-span-2">
      <ModuleKicker as="h2" color="var(--sienna)">
        {m.home_kicker_news()}
      </ModuleKicker>

      {/* 这张图不吃余量。上一轮它是弹性件(靠 has-[>img]:grow 让 Link 跟着图的存在与否
          伸缩), 改回刚性是因为它会把余量吃光, 下面的 spacer 就测不到余量、fit-level
          永远不升档 —— 实测 768 下这张图被拉到 196px, 而 16:9 基线只有 118px, 多出来
          的那 78px 本该变成两条真实的资讯标题。同样一块空间, 多几条标题比一张更大的
          图有用。顺带一个好处: has-[>img] 那套「图 404 被 SelfHidingImage 卸掉后 Link
          仍在吃余量」的坑, 随着 Link 不再 grow 自动消失了。 */}
      <Link
        to="/news/$shortId"
        params={{ shortId: headline.shortId }}
        className="group mt-3 flex flex-col no-underline"
      >
        {leadImage ? (
          // 首屏内容走 eager。保留 shrink-0: 卡内容真溢出时不许压这张图(压扁的图比
          // 溢出更难看), aspect-video 是它唯一的高度来源。
          <StoryImage
            media={leadImage}
            eager
            className="mb-3 aspect-video w-full shrink-0 rounded-xl border border-[var(--line)] object-cover"
          />
        ) : null}
        <h3 className="font-serif text-[15px] font-bold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)] sm:text-base">
          {title}
        </h3>
      </Link>

      <p className="mt-1.5 text-[11px] text-[var(--ink-soft)]">
        <time dateTime={published.toISOString()}>{timeAgo}</time>
      </p>

      {/* 次条列表既是内容也是弹性件的一部分。max-h-14 比上一轮的 max-h-20 收紧, 是
          fit-level 的前提: flex 的分配算法里触发 max-height 的项会被冻结、剩余空间
          回流给未冻结的兄弟, 于是条目各拿 min(均分份额, 56px), 下面的 spacer 拿走
          全部剩余 —— 均分负责微调(余量落在行距上), spacer 负责宏调(触发升档)。
          **不要去掉 flex-1**: 去掉后余量会全堆到 spacer(尾链上方), 次条只有一两条的
          低频日直接退回改动前的空洞。
          li 一旦成为 flex 容器, 里面的块级链接就从「撑满整行」变成 shrink-to-fit(flex
          item 的 flex-basis:auto), 热区从整行缩到文字宽 —— 实测最短一条只剩 118/462px,
          右侧 74% 的行宽变成点不动的死区。所以 <a> 必须显式 w-full。这个回退 tsc、单测、
          肉眼截图全都看不出来, 只有量 getBoundingClientRect().width 才发现。 */}
      {shownSubStories.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2 border-t border-[var(--line)] pt-3">
          {shownSubStories.map((story) => (
            <li
              key={story.shortId}
              className="flex max-h-14 flex-1 items-center"
            >
              <Link
                to="/news/$shortId"
                params={{ shortId: story.shortId }}
                className="block w-full text-[13px] leading-snug text-[var(--ink)] no-underline transition-colors hover:text-[var(--academic-brown)]"
              >
                <span aria-hidden className="mr-1.5 text-[var(--ink-soft)]">
                  ·
                </span>
                {story.title}
                {/* 副行的口径与 /news 列表页同源(同一个 news_sources_count 键): 首页
                    写「3 个来源」而列表页写别的, 读者会以为是两个不同的数。只有一个
                    来源时不出这半句 —— 「1 个来源」是废话。 */}
                {tier.meta ? (
                  <span className="mt-0.5 block pl-3 text-[11px] text-[var(--ink-soft)]">
                    {formatRelative(story.publishedAt, now, locale)}
                    {story.sourceCount > 1
                      ? ` · ${m.news_sources_count({ count: String(story.sourceCount) })}`
                      : ""}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <FitSpacer ref={spacerRef} />

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
/**
 * 周刊卡的档位: 露几条**带标题**的栏目。其余方向降级成「本期还有」里的名字。
 *
 * 上限 6 与 today.ts 的 EDITION_HIGHLIGHT_MAX 同源 —— 那边是数据供给上限, 这边是
 * 渲染档位, 两个数必须一起改, 否则要么升档时无米下锅(档位 > 供给), 要么白白把四语
 * 标题塞进首屏 HTML 却永远渲染不到(供给 > 档位)。
 *
 * **逐条递增而不是 2/4/6 跳着走**: 每把一个方向从「只有名字」升成「带标题」净增
 * 约 34px(实测 name 条 42px、highlight 条 66~77px), 而 1440 下「本期还有」那 5 条的
 * 总空白只有约 120px —— 跳着走会在 4 条时停下、白留 50px, 逐条走能升到 5 条把空白
 * 压到 20px 以内。
 */
const HIGHLIGHT_TIERS = [2, 3, 4, 5, 6] as const;

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

  // maxLevel 按实际方向数收窄: 本期只有 3 个方向时升到 tiers[1](=3) 就到头了,
  // 再往上是无米之炊 —— 探测会白跑一轮、退回来, 结果一样但多两次渲染。
  const cap = HIGHLIGHT_TIERS.findIndex((n) => n >= highlights.length);
  const { level, spacerRef, containerRef } = useFitLevel(
    cap < 0 ? HIGHLIGHT_TIERS.length - 1 : cap,
  );
  const shownCount = HIGHLIGHT_TIERS[level] ?? HIGHLIGHT_TIERS[0];
  const shownHighlights = highlights.slice(0, shownCount);
  // 没排进当前档位的重点方向, 降级到「本期还有」里只出名字 —— 与 otherNames 合并成
  // 一个列表, 读者看到的仍是「本期共 N 个方向」这个完整框架。
  const restNames = [
    ...highlights.slice(shownCount).map((h) => h.name),
    ...otherNames,
  ];

  return (
    <CardShell ref={containerRef} fitLevel={level} className="md:row-span-2">
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

      {shownHighlights.length > 0 ? (
        <ul className="mt-3 divide-y divide-[var(--line)] border-t border-[var(--line)]">
          {shownHighlights.map((h) => (
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

      {/* 「本期还有」既是内容也是弹性件的一部分。max-h-14 比上一轮的 max-h-20 收紧,
          理由与资讯卡次条列表相同(见那边的注释): 条目封顶后余量回流给下面的 spacer,
          均分只负责把小于一行的零头吸收到行距里。
          gap-1.5 是余量为 0 时的下限(均分在无余量时退化成 0, 撑不出间距)。 */}
      {restNames.length > 0 ? (
        <div className="mt-3 flex flex-col border-t border-[var(--line)] pt-2.5">
          <p className="text-[11px] font-semibold text-[var(--ink-soft)]">
            {m.home_edition_more()}
          </p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {restNames.map((name) => (
              <li
                key={name}
                className="flex max-h-14 flex-1 items-center text-[12px] leading-snug text-[var(--ink-soft)]"
              >
                {name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <FitSpacer ref={spacerRef} />

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

      {/* 这张卡没有图可以伸缩, 弹性件就是这个列表: 整块 grow、条目 flex-1 均分, 否则
          跨两行时余量会整块堆在尾链上方(实测 247px)。不加 gap: divide-y 的分隔线走
          `& > * + *` 的 border-top, 加了间距就不再贴合条目。max-h-32 比头条卡的次条
          宽松, 因为每条是「标题 2 行 + tldr 2 行」的双行块, 本身就有 60-70px 高。
          里面的 <a> 同样必须 w-full, 理由见头条卡次条列表上的注释。 */}
      <ul className="mt-3 flex grow flex-col divide-y divide-[var(--line)]">
        {picks.map((paper) => {
          const tldr = pickTldr(paper.tldr, localeKey);
          return (
            <li
              key={paper.shortId}
              className="flex max-h-32 flex-1 items-center py-2.5 first:pt-0 last:pb-0"
            >
              <Link
                to="/p/$shortId"
                params={{ shortId: paper.shortId }}
                className="group block w-full no-underline"
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

      {/* 这张图不吃余量。实测(1440/1024/768)它的高度恰好等于 16:9 × 内容宽, 整张论文卡
          的空白只有 2px —— 论文卡是整排高度的**决定者**而不是接受者, 给它加弹性纯属
          空转。余量(只有在资讯卡撑高 grid 那种少见场合才有)交给下面底座的 mt-auto 钉底。
          mb-3 必须留着, 理由见下面底座上的注释。 */}
      <Link
        to="/p/$shortId"
        params={{ shortId: paper.shortId }}
        className="group mt-3 mb-3 flex flex-col no-underline"
      >
        {paper.hasImage ? (
          // 白板图标题在左上角, object-top 保证被裁切时还认得出是哪篇。保留 shrink-0:
          // 卡内容真溢出时不许压这张图。这张图在首屏但不是 LCP(那是报头 logo), 保持 lazy。
          <SelfHidingImage
            src={`/p/${paper.shortId}/image`}
            className="mb-3 aspect-video w-full shrink-0 rounded-xl border border-[var(--line)] bg-[var(--parchment-warm)] object-cover object-top"
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

// 两条示例覆盖助手的两种用法: 检索发现 / 方法辨析。选题一律偏机器学习与 LLM
// 研究者的日常问题 —— 这张卡的读者就是他们。
//
// 为什么是 2 条而不是 3 条、也不接 fit-level: 首页那排网格只有两行, row-span-2 的是
// 资讯与周刊, 所以 row2 的高度**就等于助手卡自己的高度** —— 它的 spacer 恒为 0, 档位
// 机制一次也升不上去。这是拓扑决定的, 不是参数问题。既然它调不了, 就让它尽量矮,
// 把整排的刚性高度让给真正能调节的那两张卡。
const ASSISTANT_SAMPLES = [
  m.home_assistant_sample,
  m.home_assistant_sample_2,
] as const;

/** 工具卡:没有当日数据可放,给两句示例问题 + 输入框形状的 affordance。 */
function AssistantCard() {
  return (
    <CardShell className="transition-colors hover:border-[color-mix(in_srgb,var(--academic-brown)_40%,transparent)]">
      <ModuleKicker as="h2" color="var(--ink-soft)">
        {m.home_kicker_assistant()}
      </ModuleKicker>

      {/* 整卡仍是单个 Link, 三条示例留在链接内且不加 aria-hidden: 代价是可访问名偏长,
          收益是保住「整卡可点」这个 affordance, 而示例本身就是对这个入口的说明。
          不要拆成「示例是普通文字、只有输入框是链接」—— 那会把点击区缩到一条胶囊。 */}
      <Link to="/assistant" className="mt-3 flex grow flex-col no-underline">
        {/* 这张卡没有图可以伸缩, 弹性件就是三条示例之间的间距: 卡越高排得越开。
            gap-3 是余量为 0 时的下限(auto 外边距在那种情形下解析成 0, 撑不出间距),
            justify-between 负责把多出来的余量分配到三条之间。 */}
        <div className="flex grow flex-col justify-between gap-3">
          {ASSISTANT_SAMPLES.map((sample) => {
            const text = sample();
            return (
              <p
                key={text}
                className="font-serif text-[13.5px] leading-relaxed text-[var(--ink)]"
              >
                {text}
              </p>
            );
          })}
        </div>
        <span className="mt-auto block truncate rounded-full border border-[var(--line)] bg-[var(--parchment)] px-3 py-1.5 text-[11px] text-[var(--ink-soft)]">
          {m.home_assistant_hint()}
        </span>
      </Link>
    </CardShell>
  );
}
