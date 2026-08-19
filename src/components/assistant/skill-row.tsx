import { Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { Skeleton } from "#/components/ui/skeleton";
import { Switch } from "#/components/ui/switch";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { shortMonthDay } from "#/lib/short-date";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

export type SkillSummary =
  inferRouterOutputs<TRPCRouter>["skills"]["list"][number];

/** 上万字的技能显示成 "12.3k"：按最长的 en 形态 "65.5k chars" 量的（65536 上限） */
function formatChars(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

interface SkillRowProps {
  skill: SkillSummary;
  isToggling: boolean;
  onToggle: (enabled: boolean) => void;
}

/**
 * 技能清单的一行。整行是进编辑页的链接，开关是它的**兄弟节点**而不是子节点——
 * 把 button 套进 a 里既是无效 HTML，也会让每次点开关都顺带跳一次页。
 */
export function SkillRow({ skill, isToggling, onToggle }: SkillRowProps) {
  const locale = getLocale();
  const fullDate = skill.updatedAt.toLocaleDateString(locale);
  const chars = m.assistant_skills_body_chars({
    count: formatChars(skill.bodyChars),
  });
  const dim = !skill.enabled;
  // 内置行的 updatedAt 是占位值（new Date(0)），显示出来只会误导。
  // 这一列是密集行的元数据槽，徽章不该比技能名更抢眼：所以不换颜色、不加底色，
  // 只把字号收一档并转成页面 eyebrow 同款的字距大写——用排版而不是色彩表达
  // 「这一格是标签不是数据」。CJK 下大写是空操作，字距同样成立。
  const stamp = skill.builtin ? (
    <span className="text-[10px] uppercase tracking-[0.06em]">
      {m.assistant_skills_builtin()}
    </span>
  ) : (
    shortMonthDay(skill.updatedAt)
  );

  return (
    <article className="flex items-center border-b border-[var(--line)] transition-colors hover:bg-[var(--parchment-warm)]">
      <Link
        to="/assistant/skills/$skillId"
        params={{ skillId: skill.id }}
        className="min-w-0 flex-1 py-1.5 pl-2 no-underline"
      >
        {/* 桌面：单行四列，右侧两列固定宽右对齐才有整列对齐 */}
        <span className="hidden items-center gap-2.5 sm:flex">
          <span
            className={cn(
              "w-[150px] shrink-0 truncate font-mono text-[13px]",
              dim ? "text-[var(--ink-soft)]" : "text-[var(--ink)]",
            )}
          >
            /{skill.name}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--ink-soft)]">
            {skill.description}
          </span>
          <span className="w-[60px] shrink-0 text-right text-[10.5px] whitespace-nowrap tabular-nums text-[var(--ink-soft)]">
            {chars}
          </span>
          <span
            title={skill.builtin ? undefined : fullDate}
            className="w-[56px] shrink-0 text-right text-[10.5px] whitespace-nowrap tabular-nums text-[var(--ink-soft)]"
          >
            {stamp}
          </span>
        </span>

        {/* 移动：两行。说明单行截断，规模与日期挤在第二行右侧 */}
        <span className="flex flex-col gap-0.5 pr-1 sm:hidden">
          <span
            className={cn(
              "truncate font-mono text-[13px]",
              dim ? "text-[var(--ink-soft)]" : "text-[var(--ink)]",
            )}
          >
            /{skill.name}
          </span>
          <span className="flex items-baseline gap-2 text-[10.5px] text-[var(--ink-soft)]">
            <span className="min-w-0 flex-1 truncate">{skill.description}</span>
            <span className="shrink-0 whitespace-nowrap tabular-nums">
              {chars} · {stamp}
            </span>
          </span>
        </span>
      </Link>

      {/* size-11 的包裹层把 14px 的开关撑成 44px 触摸目标 */}
      <span className="flex size-11 shrink-0 items-center justify-center">
        <Switch
          size="sm"
          checked={skill.enabled}
          onCheckedChange={onToggle}
          disabled={isToggling}
          aria-label={`${m.assistant_skills_enabled()}: ${skill.name}`}
        />
      </span>
    </article>
  );
}

export function SkillRowSkeleton() {
  return (
    <div className="border-b border-[var(--line)]">
      <div className="hidden items-center gap-2.5 py-1.5 pl-2 sm:flex">
        <Skeleton className="h-3.5 w-[150px] shrink-0" />
        <Skeleton className="h-3 flex-1" />
        <Skeleton className="h-3 w-[60px] shrink-0" />
        <Skeleton className="h-3 w-[56px] shrink-0" />
        <span className="flex size-11 shrink-0 items-center justify-center">
          <Skeleton className="h-3.5 w-6 rounded-full" />
        </span>
      </div>
      <div className="flex flex-col gap-1.5 py-2 pl-2 sm:hidden">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  );
}
