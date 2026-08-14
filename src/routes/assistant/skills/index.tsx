import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ClipboardPaste, Loader2, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { resolveSkillErrorMessage } from "#/components/assistant/skill-error";
import { SkillRow } from "#/components/assistant/skill-row";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { useRequireAuth } from "#/hooks/use-require-auth";
import { useTRPC } from "#/integrations/trpc/react";
import {
  parseSkillImport,
  SKILL_LIMITS,
  type SkillImportError,
  type SkillInput,
} from "#/lib/skills";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/assistant/skills/")({
  component: AssistantSkillsListPage,
  head: () => ({
    meta: [{ title: m.assistant_skills_title() }],
  }),
});

/** parseSkillImport 的错误分两档：frontmatter 形状不对 vs 字段内容不合法 */
function resolveImportErrorMessage(error: SkillImportError): string {
  return error === "invalid_fields"
    ? m.assistant_skills_import_error_fields()
    : m.assistant_skills_import_error_format();
}

type StatusFilter = "enabled" | "disabled" | null;

/** 导入对话框：只解析、不落库；成功后把三个字段交给父级，转去新建页 */
function ImportSkillDialog({
  onApply,
}: {
  onApply: (value: SkillInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<SkillImportError | null>(null);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setText("");
      setError(null);
    }
  };

  const handleApply = () => {
    const result = parseSkillImport(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleOpenChange(false);
    onApply(result.value);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <ClipboardPaste className="h-4 w-4" />
          {m.assistant_skills_import()}
        </Button>
      </DialogTrigger>
      <DialogContent className="border-[var(--line)] bg-[var(--parchment)] sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-[var(--ink)]">
            {m.assistant_skills_import()}
          </DialogTitle>
          <DialogDescription className="text-[var(--ink-soft)]">
            {m.assistant_skills_import_hint()}
          </DialogDescription>
        </DialogHeader>
        <div>
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            rows={12}
            aria-label={m.assistant_skills_import()}
            aria-invalid={error != null || undefined}
            spellCheck={false}
            className={cn(
              "w-full resize-none rounded-md border bg-[var(--parchment-warm)]/50 px-3 py-2 font-mono text-xs leading-relaxed text-[var(--ink)] transition-colors outline-none",
              error
                ? "border-[var(--sienna)]/70"
                : "border-[var(--line)] focus:border-[var(--academic-brown)]/60",
            )}
          />
          {error && (
            <p role="alert" className="mt-1 text-xs text-[var(--sienna)]">
              {resolveImportErrorMessage(error)}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" onClick={handleApply} disabled={!text.trim()}>
            {m.assistant_skills_import_apply()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssistantSkillsListPage() {
  const { session, isSessionPending } = useRequireAuth("/assistant/skills");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);

  const listQuery = useQuery({
    ...trpc.skills.list.queryOptions(),
    enabled: !!session,
  });
  const skills = listQuery.data;
  const used = skills?.length ?? 0;
  const enabledCount = skills?.filter((row) => row.enabled).length ?? 0;
  const disabledCount = used - enabledCount;

  const updateMutation = useMutation(
    trpc.skills.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.skills.list.queryKey(),
        });
      },
      onError: (error) => {
        // 静默失败会让用户以为切换生效了：重新拉一次校回真值，并弹 toast 说明
        void queryClient.invalidateQueries({
          queryKey: trpc.skills.list.queryKey(),
        });
        toast.error(resolveSkillErrorMessage(error));
      },
    }),
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (skills ?? []).filter((row) => {
      if (statusFilter === "enabled" && !row.enabled) return false;
      if (statusFilter === "disabled" && row.enabled) return false;
      if (!term) return true;
      return (
        row.name.toLowerCase().includes(term) ||
        row.description.toLowerCase().includes(term)
      );
    });
  }, [skills, search, statusFilter]);

  const usagePercent = Math.min(100, (used / SKILL_LIMITS.maxPerUser) * 100);

  const handleImportApply = (value: SkillInput) => {
    void navigate({
      to: "/assistant/skills/new",
      state: { skillDraft: value },
    });
  };

  const toggleFilter = (next: Exclude<StatusFilter, null>) => {
    setStatusFilter((current) => (current === next ? null : next));
  };

  if (isSessionPending) {
    return (
      <main className="page-wrap flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--academic-brown)]" />
      </main>
    );
  }

  // 未登录会被 useRequireAuth 送去登录页，这里不渲染任何东西
  if (!session) return null;

  const listBody = listQuery.isPending ? (
    <div className="flex justify-center py-12">
      <Loader2 className="h-5 w-5 animate-spin text-[var(--academic-brown)]" />
    </div>
  ) : listQuery.isError ? (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm text-[var(--ink-soft)]">
        {resolveSkillErrorMessage(listQuery.error)}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void listQuery.refetch()}
      >
        {m.assistant_history_retry()}
      </Button>
    </div>
  ) : used === 0 ? (
    <p className="py-12 text-center text-sm leading-relaxed text-[var(--ink-soft)]">
      {m.assistant_skills_empty()}
    </p>
  ) : visible.length === 0 ? (
    <p className="py-12 text-center text-sm leading-relaxed text-[var(--ink-soft)]">
      {m.assistant_skills_search_no_match()}
    </p>
  ) : (
    <div className="[&>article:last-child]:border-b-0">
      {visible.map((skill) => (
        <SkillRow
          key={skill.id}
          skill={skill}
          isToggling={
            updateMutation.isPending &&
            updateMutation.variables?.id === skill.id
          }
          onToggle={(enabled) =>
            updateMutation.mutate({ id: skill.id, enabled })
          }
        />
      ))}
    </div>
  );

  return (
    <main className="page-wrap py-8">
      <Link
        to="/assistant"
        className="inline-flex items-center gap-1 rounded-sm text-xs text-[var(--ink-soft)] transition-colors hover:text-[var(--academic-brown)] focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:outline-none"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {m.assistant_skills_back()}
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] tracking-[0.18em] text-[var(--ink-soft)] uppercase">
            {m.assistant_page_title()}
          </p>
          <h1 className="font-serif text-2xl text-[var(--ink)]">
            {m.assistant_skills_title()}
            <span className="ml-2 text-sm font-normal tabular-nums text-[var(--ink-soft)]">
              · {used} / {SKILL_LIMITS.maxPerUser}
            </span>
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button asChild variant="outline" size="sm">
            <Link to="/assistant/skills/new">
              <Plus className="h-4 w-4" />
              {m.assistant_skills_new()}
            </Link>
          </Button>
          <ImportSkillDialog onApply={handleImportApply} />
        </div>
      </div>

      {/* 用量细线：底色是发丝线，填充按 used/maxPerUser 走金色 */}
      <div
        role="img"
        aria-label={`${used} / ${SKILL_LIMITS.maxPerUser}`}
        className="mt-3 h-0.5 w-full rounded-full bg-[var(--line)]"
      >
        <div
          className="h-full rounded-full bg-[var(--gold)] transition-[width]"
          style={{ width: `${usagePercent}%` }}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-soft)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={m.assistant_skills_search_placeholder()}
            aria-label={m.assistant_skills_search_placeholder()}
            className="pl-9"
          />
        </div>
        {enabledCount > 0 && (
          <button
            type="button"
            onClick={() => toggleFilter("enabled")}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              statusFilter === "enabled"
                ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--academic-brown-deep)]"
                : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--gold)]",
            )}
          >
            {m.assistant_skills_filter_enabled()} {enabledCount}
          </button>
        )}
        {disabledCount > 0 && (
          <button
            type="button"
            onClick={() => toggleFilter("disabled")}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              statusFilter === "disabled"
                ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--academic-brown-deep)]"
                : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--gold)]",
            )}
          >
            {m.assistant_skills_filter_disabled()} {disabledCount}
          </button>
        )}
      </div>

      <div className="mt-5">{listBody}</div>
    </main>
  );
}
