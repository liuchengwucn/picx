import { FileText, Filter, SearchX } from "lucide-react";
import { m } from "#/paraglide/messages";

export type PaperEmptyKind = "library" | "search" | "filter";

const CONFIG: Record<
  PaperEmptyKind,
  { icon: React.ElementType; title: () => string; desc: () => string }
> = {
  library: {
    icon: FileText,
    title: () => m.papers_empty_title(),
    desc: () => m.papers_empty_description(),
  },
  search: {
    icon: SearchX,
    title: () => m.papers_no_results_title(),
    desc: () => m.papers_no_results_desc(),
  },
  filter: {
    icon: Filter,
    title: () => m.papers_filtered_empty_title(),
    desc: () => m.papers_filtered_empty_desc(),
  },
};

export function PaperEmptyState({ kind }: { kind: PaperEmptyKind }) {
  const config = CONFIG[kind];
  const Icon = config.icon;
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-16 text-center">
      <Icon className="mx-auto size-8 text-[var(--ink-soft)] opacity-60" />
      <h2 className="mt-4 font-serif text-lg font-semibold text-[var(--ink)]">
        {config.title()}
      </h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">{config.desc()}</p>
    </div>
  );
}
