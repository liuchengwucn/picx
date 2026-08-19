import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import {
  type EditionPickView,
  PickEntry,
} from "#/components/digest/pick-entry";
import { ModuleKicker } from "#/components/home/module-kicker";
import { m } from "#/paraglide/messages";

export interface EditionSectionView {
  directionSlug: string;
  directionName: string;
  issueNumber: number;
  title: string;
  excerpt: string;
  pickCount: number;
  picks: EditionPickView[];
}

/**
 * 合刊里的一个方向栏目。栏眉复用首页的报刊栏眉(7px 方块 + 发丝线), 方块用方向
 * 识别色, 栏目名走 --ink-soft —— 别把 accent 传给文字(ModuleKicker 的既有约定)。
 *
 * id 是脊上锚点与滚动跟随的锚：两处都按 `section-${slug}` 取, 别改成随机 id。
 */
export function DirectionSection({
  section,
  accent,
}: {
  section: EditionSectionView;
  accent: string;
}) {
  const issueParams = {
    slug: section.directionSlug,
    issue: String(section.issueNumber),
  };
  return (
    <section
      id={`section-${section.directionSlug}`}
      // scroll-mt 让锚点跳转后栏眉不被吸顶层盖住。窄屏要同时躲开 header(60px)与
      // 吸顶 chip 行(约 41px), 所以 9rem; 宽屏只有 header, 6rem 够。实测 375px 下
      // 跳转后栏眉落在 chip 行下方 25px。
      className="scroll-mt-36 lg:scroll-mt-24"
    >
      <ModuleKicker as="h2" color={accent}>
        {/* 颜色一律挂在 <a> 内层的 span 上, 不挂 <a> 自己: styles.css 里那条
            `a { color: var(--academic-brown) }` 是未分层规则, 在 CSS 层叠里压过
            Tailwind v4 的 utilities 层, 直接写在 <a> 上的 text-* 会被静默吃掉
            (实测栏目名与期标题都会渲染成棕色而不是 --ink/--ink-soft)。全站既有
            组件(gallery-card / digest-paper-card)也都是把色挂在 <a> 内的元素上。 */}
        <Link
          to="/gallery/d/$slug"
          params={{ slug: section.directionSlug }}
          activeOptions={{ exact: true }}
          className="group no-underline"
        >
          <span className="text-[var(--ink-soft)] transition-colors group-hover:text-[var(--ink)]">
            {section.directionName}
          </span>
        </Link>
        <span className="text-[var(--ink-soft)]/70">
          {" · "}
          {m.digest_issue_n({ n: String(section.issueNumber) })}
        </span>
      </ModuleKicker>

      {/* 62ch 是这一页唯一的正文测量: 主列在宽屏有近 1000px, 不封口的话看点摘要
          会拉成 130 字符一行, 读起来要来回找行首 */}
      <div className="max-w-[62ch]">
        <h3 className="mt-2.5 font-serif text-lg font-bold leading-snug sm:text-xl">
          <Link
            to="/gallery/d/$slug/$issue"
            params={issueParams}
            className="group no-underline"
          >
            <span className="text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown-deep)]">
              {section.title}
            </span>
          </Link>
        </h3>

        {section.excerpt ? (
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
            {section.excerpt}
          </p>
        ) : null}

        {section.picks.length > 0 ? (
          // ol 而不是 ul: rank 是编辑排序, 顺序本身带信息
          <ol className="mt-3.5 list-none">
            {section.picks.map((pick, i) => (
              <PickEntry key={pick.id} pick={pick} lead={i === 0} />
            ))}
          </ol>
        ) : null}

        <Link
          to="/gallery/d/$slug/$issue"
          params={issueParams}
          // 不写 text-[var(--academic-brown)]: 上面那条注释说的同一个原因, 写在
          // <a> 上是死类; 而全局 a{} 给的正好就是这个色(hover 也给了 deep)
          className="group mt-3 inline-flex items-center gap-1 text-[11px] font-semibold no-underline"
        >
          {m.edition_all_picks({ n: String(section.pickCount) })}
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            strokeWidth={1.25}
            aria-hidden
          />
        </Link>
      </div>
    </section>
  );
}
