import type { ReactNode } from "react";
import { DirectionSection } from "#/components/digest/direction-section";
import { EditionMasthead } from "#/components/digest/edition-masthead";
import { EditionSpine } from "#/components/digest/edition-spine";
import {
  assignDirectionHues,
  type DirectionColorInput,
  directionAccent,
} from "#/lib/digest/direction-color";
import type { EditionView as EditionData } from "#/lib/digest/present";

/**
 * 合刊主体。/gallery(最新一期)与 /gallery/w/$period(某一期)共用同一个组件:
 * 两个页面长得一样, 分成两份实现必然各自漂移。
 *
 * children 是页尾插槽(往期列表只在落地页出)。
 */
export function EditionView({
  edition,
  allDirections,
  children,
}: {
  edition: EditionData;
  /**
   * 全量 active 方向, 不是本期有栏目的方向。先到先得的槽位占用取决于输入集合,
   * 只喂本期栏目会让「某方向本周缺席」把其他方向的颜色挤位 —— 那正是这套算法
   * 要避免的事。
   */
  allDirections: readonly DirectionColorInput[];
  children?: ReactNode;
}) {
  // 色相表按 allDirections ∪ 本期栏目建。并集这一半不是防御性代码: 它让查表全覆盖,
  // 于是下面不需要 `?? 某个默认色相` —— 而默认色相恰恰是这个模块要防的东西(悄悄
  // 冒出两个同为铁锈色的方向, 只能靠眼睛发现)。栏目自带 directionCreatedAt 正是
  // 为此才一路穿到客户端的, 有了这里它才有消费者。
  const colorInputs = new Map<string, DirectionColorInput>();
  for (const d of allDirections) colorInputs.set(d.slug, d);
  for (const s of edition.sections) {
    // 重复 slug 会在先到先得里占掉两个槽位、把后面的方向挤位, 所以按 slug 去重;
    // allDirections 那份优先(它是权威的 active 方向表)
    if (!colorInputs.has(s.directionSlug)) {
      colorInputs.set(s.directionSlug, {
        slug: s.directionSlug,
        createdAt: s.directionCreatedAt,
      });
    }
  }
  const hues = assignDirectionHues([...colorInputs.values()]);
  const accentOf = (slug: string) => {
    const hue = hues.get(slug);
    // 并集建表之后这里查不到已经不可能。真查不到 = 有人把 sections 换成了别的集合,
    // 那时回退成一个「看起来很正常」的暖色是最坏的处理(它会和某个方向撞成同一块
    // 铁锈色, 只能靠眼睛发现); 退成中性灰至少不冒充识别色。
    return hue === undefined ? "var(--ink-soft)" : directionAccent(hue);
  };
  const pickCount = edition.sections.reduce((sum, s) => sum + s.pickCount, 0);

  // max-w-5xl 是本仓库「正文 + 侧栏」页面的既有口径(news/$shortId 有 aside 时同值):
  // 1200px 的 page-wrap 留给多列列表页, 周刊是读物, 主列再宽就没人从行尾走回行首了
  return (
    <div className="page-wrap max-w-5xl">
      <EditionMasthead
        period={edition.period}
        periodStart={edition.periodStart}
        periodEnd={edition.periodEnd}
        isLatest={edition.isLatest}
        activeDirectionCount={edition.activeDirectionCount}
        updatedDirectionCount={edition.sections.length}
        pickCount={pickCount}
      />

      <div className="mt-5 lg:grid lg:grid-cols-[172px_minmax(0,1fr)] lg:gap-x-10">
        <EditionSpine
          items={edition.sections.map((s) => ({
            slug: s.directionSlug,
            name: s.directionName,
            pickCount: s.pickCount,
            accent: accentOf(s.directionSlug),
          }))}
          showPastAnchor={Boolean(children)}
        />
        <div className="flex flex-col gap-9">
          {edition.sections.map((s) => (
            <DirectionSection
              key={s.directionSlug}
              section={s}
              accent={accentOf(s.directionSlug)}
            />
          ))}
        </div>
      </div>

      {children}
    </div>
  );
}
