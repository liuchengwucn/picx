import { Skeleton } from "#/components/ui/skeleton";

/**
 * 合刊的加载骨架。/gallery 与 /gallery/w/$period 共用(两页正文是同一个组件, 骨架
 * 分成两份必然各自漂移)。
 *
 * 形状刻意贴 EditionView 的真实排版, 而不是几条通用灰条: 栏眉的 7px 方块与发丝线、
 * 刊头那道 2px 实线、竖脊的左引线、picks 的分隔线全部照常画出来 —— 这些结构线在真
 * 正的页面里也一直在, 画出来读者看到的是「同一页还没填字」, 换成灰块矩阵看到的是
 * 「另一个页面」, 数据到位那一瞬间的跳变也小得多。
 */
const SECTION_KEYS = ["a", "b"] as const;
const SPINE_KEYS = ["a", "b", "c", "d", "e", "f", "g"] as const;
const PICK_KEYS = ["a", "b"] as const;

export function EditionSkeleton() {
  return (
    <div className="page-wrap max-w-5xl">
      {/* 刊头: 栏眉行 / 衬线大字 / 右侧两行元信息 / 2px 收口实线 */}
      <header className="border-b-2 border-[var(--ink)] pb-2">
        <KickerLine width="w-24" />
        <div className="mt-1.5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-x-4">
          <Skeleton className="h-8 w-40 sm:h-9 sm:w-56" />
          <div className="flex flex-col gap-1 sm:items-end">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-3 w-44" />
          </div>
        </div>
      </header>

      <div className="mt-5 lg:grid lg:grid-cols-[172px_minmax(0,1fr)] lg:gap-x-10">
        {/* 竖脊只在宽屏存在(窄屏那条吸顶 chip 行不画骨架: 它是吸顶层, 骨架期给一条
            假的吸顶行会在数据到位时把整页往下顶一次) */}
        <div className="hidden lg:block">
          <Skeleton className="h-2.5 w-16" />
          <div className="mt-2.5 space-y-2.5 border-l border-[var(--line)] pl-3">
            {SPINE_KEYS.map((k) => (
              <Skeleton key={k} className="h-3 w-full" />
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

/** ModuleKicker 的骨架:同样是 7px 方块 + 文字 + 贯通到右缘的发丝线 */
function KickerLine({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="h-[7px] w-[7px] flex-none bg-[var(--line)]"
      />
      <Skeleton className={`h-2.5 ${width}`} />
      <span aria-hidden className="h-px flex-1 bg-[var(--line)]" />
    </div>
  );
}

function SectionSkeleton() {
  return (
    <section>
      <KickerLine width="w-32" />
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
