// 方向列表。含 isActive=false 的方向（管理页要看得见停用的），停用行整行降透明度
// 并挂一枚「已停用」徽标。每行折叠成一条摘要，展开才是完整表单——四语名称 + 四语
// 简介 + focusBrief + 源清单一行铺开的话，三个方向就是一屏放不下的墙。
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Rss } from "lucide-react";
import { useState } from "react";
import { AdminEmpty, AdminSection, Pill } from "#/components/admin/admin-ui";
import { DirectionForm } from "#/components/admin/direction-form";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { useTRPC } from "#/integrations/trpc/react";
import { normalizeLocaleKey, pickTldr } from "#/lib/tldr";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

const SKELETON_KEYS = ["dir-sk-1", "dir-sk-2", "dir-sk-3"];

export function DirectionPanel() {
  const trpc = useTRPC();
  const localeKey = normalizeLocaleKey(getLocale());
  const directionsQuery = useQuery(trpc.admin.listDirections.queryOptions());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const directions = directionsQuery.data ?? [];

  return (
    <AdminSection
      anchorId="directions"
      title={m.admin_section_directions()}
      count={directionsQuery.data?.length}
      action={
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="admin-add-direction"
          onClick={() => {
            setAdding((value) => !value);
            setExpandedId(null);
          }}
        >
          <Plus className="size-3.5" />
          {m.admin_add_direction()}
        </Button>
      }
    >
      {adding ? (
        <div className="mb-5 rounded-xl border border-[var(--academic-brown)] bg-[var(--surface-strong)] p-5">
          <DirectionForm direction={null} onDone={() => setAdding(false)} />
        </div>
      ) : null}

      {directionsQuery.isPending ? (
        <div className="space-y-3">
          {SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : directionsQuery.isError ? (
        <p className="py-6 text-sm font-medium text-[var(--sienna)]">
          {m.admin_error_generic()}
        </p>
      ) : directions.length === 0 ? (
        adding ? null : (
          <AdminEmpty>{m.admin_add_direction()}</AdminEmpty>
        )
      ) : (
        <ul className="space-y-3">
          {directions.map((direction) => {
            const expanded = expandedId === direction.id;
            // 折叠行只回答一个问题：这个方向的抓取还活着吗。具体是哪一条源坏了、
            // 坏在什么错误上，展开后源清单里逐条写着。
            const unhealthySources = direction.sources.filter(
              (source) => !source.enabled || source.consecutiveFailures > 0,
            ).length;
            return (
              <li
                key={direction.id}
                data-testid="admin-direction-row"
                data-slug={direction.slug}
                className={`rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] ${
                  direction.isActive ? "" : "opacity-60"
                }`}
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  data-testid="admin-direction-toggle"
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left"
                  onClick={() => {
                    setExpandedId(expanded ? null : direction.id);
                    setAdding(false);
                  }}
                >
                  {expanded ? (
                    <ChevronDown className="size-4 shrink-0 text-[var(--ink-soft)]" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-[var(--ink-soft)]" />
                  )}
                  <span className="font-mono text-sm text-[var(--academic-brown-deep)]">
                    {direction.slug}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">
                    {pickTldr(direction.name, localeKey) ?? direction.slug}
                  </span>
                  {direction.isActive ? null : (
                    <Pill tone="neutral">{m.admin_inactive()}</Pill>
                  )}
                  <span
                    title={
                      unhealthySources > 0
                        ? m.admin_source_failures({
                            count: String(unhealthySources),
                          })
                        : m.admin_sources()
                    }
                    className={`inline-flex items-center gap-1 font-mono text-[0.7rem] tabular-nums ${
                      unhealthySources > 0
                        ? "font-semibold text-[var(--sienna)]"
                        : "text-[var(--ink-soft)]"
                    }`}
                  >
                    <Rss aria-hidden="true" className="size-3" />
                    {direction.sources.length}
                  </span>
                </button>
                {expanded ? (
                  <div className="border-t border-[var(--line)] px-4 py-5">
                    <DirectionForm
                      direction={direction}
                      onDone={() => setExpandedId(null)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </AdminSection>
  );
}
