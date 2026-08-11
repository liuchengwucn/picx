import { ChevronDown, X } from "lucide-react";
import { getCategoryLabel } from "#/components/papers/gallery-card";
import { Button } from "#/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import {
  PAPER_CATEGORY_SLUGS,
  type PaperCategorySlug,
} from "#/lib/paper-categories";
import { m } from "#/paraglide/messages";

interface PaperTopicFilterProps {
  categories: PaperCategorySlug[];
  tags: string[];
  onToggleCategory: (slug: PaperCategorySlug) => void;
  onRemoveTag: (tag: string) => void;
  onClearAll: () => void;
}

/**
 * 主题筛选放进 Popover 而不是像 gallery 那样平铺 ——
 * 平铺 12+ 个分类要占两行高度,与本页的密度目标直接冲突。
 * 已选项在下方的已选筛选行里显示,语汇与 gallery 一致。
 */
export function PaperTopicFilterButton({
  categories,
  onToggleCategory,
}: Pick<PaperTopicFilterProps, "categories" | "onToggleCategory">) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={categories.length > 0 ? "default" : "outline"}
          className="h-[26px] shrink-0 rounded-full px-3 py-0 text-xs"
        >
          {m.papers_topic_filter()}
          {categories.length > 0 && ` · ${categories.length}`}
          <ChevronDown className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={m.papers_topic_filter()}
        className="max-h-(--radix-popover-content-available-height) w-72 overflow-y-auto p-3"
      >
        <div className="flex flex-wrap gap-1.5">
          {PAPER_CATEGORY_SLUGS.map((slug) => {
            const isActive = categories.includes(slug);
            return (
              <button
                key={slug}
                type="button"
                onClick={() => onToggleCategory(slug)}
                aria-pressed={isActive}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "border-[var(--academic-brown)] bg-[var(--academic-brown)] text-white"
                    : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--academic-brown)] hover:text-[var(--academic-brown)]"
                }`}
              >
                {getCategoryLabel(slug)}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function PaperActiveFilters({
  categories,
  tags,
  onToggleCategory,
  onRemoveTag,
  onClearAll,
}: PaperTopicFilterProps) {
  if (categories.length === 0 && tags.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-[var(--ink-soft)]">
        {m.papers_filtered_label()}
      </span>
      {categories.map((slug) => (
        <span
          key={`cat-${slug}`}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--academic-brown)]/30 bg-[var(--academic-brown)]/8 px-2.5 py-0.5 text-xs text-[var(--academic-brown)]"
        >
          {getCategoryLabel(slug)}
          <button
            type="button"
            onClick={() => onToggleCategory(slug)}
            className="-my-1 -mr-1 ml-0.5 inline-flex size-5 items-center justify-center hover:opacity-70"
            aria-label={m.papers_remove_filter({
              label: getCategoryLabel(slug),
            })}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {tags.map((tag) => (
        <span
          key={`tag-${tag}`}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-2.5 py-0.5 text-xs text-[var(--ink)]"
        >
          #{tag}
          <button
            type="button"
            onClick={() => onRemoveTag(tag)}
            className="-my-1 -mr-1 ml-0.5 inline-flex size-5 items-center justify-center hover:opacity-70"
            aria-label={m.papers_remove_filter({ label: `#${tag}` })}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-xs text-[var(--academic-brown)] transition-opacity hover:opacity-70"
      >
        {m.papers_clear_filters()}
      </button>
    </div>
  );
}
