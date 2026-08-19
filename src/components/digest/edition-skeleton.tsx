import { ModuleKicker } from "#/components/home/module-kicker";
import { Skeleton } from "#/components/ui/skeleton";

const SECTION_KEYS = ["a", "b"] as const;
const SPINE_KEYS = ["a", "b", "c", "d", "e", "f", "g"] as const;
const PICK_KEYS = ["a", "b"] as const;
const SPINE_TAIL_KEYS = ["a", "b"] as const;

/**
 * 一条「占一行文字」的灰条。必须是 inline-block: Skeleton 本体是块级 div, 放进真实排版
 * 的行内容器(ModuleKicker 的 <span>、刊头元信息的 <div>)里会把行盒压成灰条自己的高度,
 * 于是骨架比真实排版矮一截 —— 实测刊头曾因此 70px vs 真实 91px。inline-block 让行盒
 * 回到字体 strut 决定, 高度自动随所在容器的字号与行高走, 不需要在这里抄数字。
 */
function SkeletonText({ className }: { className?: string }) {
  return (
    <Skeleton
      className={`inline-block h-2.5 align-middle ${className ?? ""}`}
    />
  );
}

/**
 * 合刊的加载骨架。/gallery 与 /gallery/w/$period 共用(两页正文是同一个组件, 骨架
 * 分成两份必然各自漂移)。
 *
 * 形状刻意贴 EditionView 的真实排版, 而不是几条通用灰条: 栏眉的 7px 方块与发丝线、
 * 刊头那道 2px 实线、竖脊的左引线、picks 的分隔线全部照常画出来 —— 这些结构线在真
 * 正的页面里也一直在, 画出来读者看到的是「同一页还没填字」, 换成灰块矩阵看到的是
 * 「另一个页面」, 数据到位那一瞬间的跳变也小得多。
 *
 * 栏眉直接渲染真的 <ModuleKicker>(色传 --line, 文字位置塞 <Skeleton>)而不是手抄一份
 * 同款排版: 手抄那版实测把刊头做矮了 29px(骨架 62px vs 真实 91px) —— 抄的是
 * `h-2.5`(10px), 而 ModuleKicker 的 `text-[11px]` 行盒约 17px。复用真组件之后这种
 * 漂移在结构上不可能再发生。
 *
 * 总高度仍然对不上真实页面(骨架 ~1026px vs 真实 ~3650px), 那是栏目数不可知导致的,
 * 只向下生长、不影响读者视线落点, 刻意不管。
 */
export function EditionSkeleton() {
  return (
    <div className="page-wrap max-w-5xl">
      {/* 刊头: 栏眉行 / 衬线大字 / 右侧三行元信息 / 2px 收口实线 */}
      <header className="border-b-2 border-[var(--ink)] pb-2">
        <ModuleKicker as="div" color="var(--line)">
          <SkeletonText className="w-24" />
        </ModuleKicker>
        <div className="mt-1.5 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-x-4">
          <Skeleton className="h-8 w-40 sm:h-9 sm:w-56" />
          {/* 三行: 日期区间 / 「N 个方向 · M 篇入选」/ 永久链接 —— 与 isLatest 那支
              一致(骨架期还不知道是哪一支, 按行数多的那支画, 数据到位只会收缩不会撑开)。
              行盒交给与真实刊头同一份 text-xs/leading-relaxed 决定, 灰条只管宽度:
              换成 h-3 的块级条会把每行做矮 7.5px(12 vs 19.5), 三行累计差 22.5px。 */}
          <div className="text-xs leading-relaxed sm:text-right">
            <div>
              <SkeletonText className="w-36" />
            </div>
            <div>
              <SkeletonText className="w-44" />
            </div>
            <div>
              <SkeletonText className="w-28" />
            </div>
          </div>
        </div>
      </header>

      <div className="mt-5 lg:grid lg:grid-cols-[172px_minmax(0,1fr)] lg:gap-x-10">
        {/* 竖脊只在宽屏存在(窄屏那条吸顶 chip 行不画骨架: 它是吸顶层, 骨架期给一条
            假的吸顶行会在数据到位时把整页往下顶一次) */}
        {/* self-start 与真实竖脊一致: 少了它这一列会被 grid 拉伸到正文列的高度 */}
        <div className="hidden lg:block lg:self-start">
          <Skeleton className="h-2.5 w-16" />
          <div className="mt-2.5 space-y-2.5 border-l border-[var(--line)] pl-3">
            {SPINE_KEYS.map((k) => (
              <Skeleton key={k} className="h-3 w-full" />
            ))}
          </div>
          {/* 脊尾那两条链接(往期合刊 / 档案)也占位, 否则数据到位时脊会突然长出两行 */}
          <div className="mt-3 space-y-1 pl-3">
            {SPINE_TAIL_KEYS.map((k) => (
              <Skeleton key={k} className="h-3 w-20" />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-9">
          {SECTION_KEYS.map((k) => (
            <SectionSkeleton key={k} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionSkeleton() {
  return (
    <section>
      <ModuleKicker as="div" color="var(--line)">
        <SkeletonText className="w-32" />
      </ModuleKicker>
      {/* 62ch 是 DirectionSection 的正文封口宽度, 骨架也要封, 否则宽屏上骨架比正文宽 */}
      <div className="max-w-[62ch]">
        <Skeleton className="mt-2.5 h-6 w-4/5 sm:h-7" />
        <div className="mt-3 space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-10/12" />
        </div>
        <div className="mt-3.5">
          {/* 头条带 118px / 3:2 的白板缩略图, 其余两条纯文字 —— 与 PickEntry 一致 */}
          <div className="flex items-start gap-3 border-t border-[var(--line)] py-2.5">
            <Skeleton
              className="w-[118px] shrink-0"
              style={{ aspectRatio: "3 / 2" }}
            />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
          {PICK_KEYS.map((k) => (
            <div
              key={k}
              className="space-y-2 border-t border-[var(--line)] py-2.5"
            >
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-11/12" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-3 h-3 w-28" />
      </div>
    </section>
  );
}
