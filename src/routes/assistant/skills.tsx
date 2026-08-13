import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowLeft,
  Check,
  ClipboardPaste,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
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
import { Switch } from "#/components/ui/switch";
import { useRequireAuth } from "#/hooks/use-require-auth";
import { useTRPC } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";
import {
  parseSkillImport,
  SKILL_LIMITS,
  type SkillImportError,
  type SkillInput,
  skillInputSchema,
} from "#/lib/skills";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/assistant/skills")({
  component: AssistantSkillsPage,
  head: () => ({
    meta: [{ title: m.assistant_skills_title() }],
  }),
});

type SkillSummary = inferRouterOutputs<TRPCRouter>["skills"]["list"][number];

/** tRPC 错误码 → 页面文案。四条之外一律走通用兜底 */
function resolveSkillErrorMessage(error: unknown): string {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  switch (code) {
    case "CONFLICT":
      return m.assistant_skills_error_conflict();
    case "PRECONDITION_FAILED":
      return m.assistant_skills_error_limit();
    case "FORBIDDEN":
      return m.assistant_skills_error_readonly();
    default:
      return m.assistant_skills_error_generic();
  }
}

/** parseSkillImport 的错误分两档：frontmatter 形状不对 vs 字段内容不合法 */
function resolveImportErrorMessage(error: SkillImportError): string {
  return error === "invalid_fields"
    ? m.assistant_skills_import_error_fields()
    : m.assistant_skills_import_error_format();
}

const EMPTY_FORM: SkillInput = { name: "", description: "", body: "" };

type SkillFormField = keyof SkillInput;

const FIELD_BOX_CLASS =
  "w-full rounded-md border bg-[var(--parchment-warm)]/50 px-3 py-2 text-sm text-[var(--ink)] transition-colors outline-none placeholder:text-[var(--ink-soft)]";

interface SkillEditorProps {
  /** 初始值：编辑态来自 get 的整行，新建态为空表单或导入解析结果 */
  initial: SkillInput;
  isSaving: boolean;
  isDeleting: boolean;
  onSave: (values: SkillInput) => void;
  /** 仅编辑态提供；新建态没有可删的东西 */
  onDelete?: () => void;
}

/**
 * 技能表单。由父级用 key 控制重挂：换选中项 / 新建 / 导入都换 key，
 * 受控 state 从 initial 重新起步，天然避开「异步 get 回填盖掉用户输入」的竞态。
 */
function SkillEditor({
  initial,
  isSaving,
  isDeleting,
  onSave,
  onDelete,
}: SkillEditorProps) {
  const fieldId = useId();
  const [values, setValues] = useState(initial);
  const [invalidFields, setInvalidFields] = useState<
    ReadonlySet<SkillFormField>
  >(new Set());
  /** 删除的就地两步确认（同会话列表的模式，不弹系统对话框） */
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const setField = (field: SkillFormField, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    // 用户一动这个字段就清掉它的红态，下次提交再统一重算
    setInvalidFields((previous) => {
      if (!previous.has(field)) return previous;
      const next = new Set(previous);
      next.delete(field);
      return next;
    });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // 与后端同一份 zod：这里只决定「要不要发请求」，不另写规则
    const parsed = skillInputSchema.safeParse(values);
    if (!parsed.success) {
      setInvalidFields(
        new Set(
          parsed.error.issues.map(
            (issue) => String(issue.path[0]) as SkillFormField,
          ),
        ),
      );
      return;
    }
    setInvalidFields(new Set());
    onSave(parsed.data);
  };

  const labelClass =
    "text-[11px] tracking-[0.18em] text-[var(--ink-soft)] uppercase";
  // 校验失败时字段下方的提示由灰转赭：提示本身就说明了合法形状，不再另配错误文案
  const hintClass = (field: SkillFormField) =>
    cn(
      "mt-1 text-[11px] leading-snug",
      invalidFields.has(field)
        ? "text-[var(--sienna)]"
        : "text-[var(--ink-soft)]",
    );
  const borderClass = (field: SkillFormField) =>
    invalidFields.has(field)
      ? "border-[var(--sienna)]/70"
      : "border-[var(--line)] focus-within:border-[var(--academic-brown)]/60 focus:border-[var(--academic-brown)]/60";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor={`${fieldId}-name`} className={labelClass}>
          {m.assistant_skills_name_label()}
        </label>
        <div
          className={cn(
            "mt-1 flex items-center rounded-md border bg-[var(--parchment-warm)]/50 transition-colors",
            borderClass("name"),
          )}
        >
          {/* 名字就是斜杠指令：把 / 画进输入框，与聊天里的触发方式对上号 */}
          <span
            aria-hidden="true"
            className="pl-3 font-mono text-sm text-[var(--academic-brown)]"
          >
            /
          </span>
          <input
            id={`${fieldId}-name`}
            value={values.name}
            onChange={(event) => setField("name", event.target.value)}
            maxLength={SKILL_LIMITS.nameMax}
            aria-invalid={invalidFields.has("name") || undefined}
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-transparent py-2 pr-3 pl-0.5 font-mono text-sm text-[var(--ink)] outline-none"
          />
        </div>
        <p className={hintClass("name")}>{m.assistant_skills_name_hint()}</p>
      </div>

      <div>
        <label htmlFor={`${fieldId}-description`} className={labelClass}>
          {m.assistant_skills_description_label()}
        </label>
        <input
          id={`${fieldId}-description`}
          value={values.description}
          onChange={(event) => setField("description", event.target.value)}
          maxLength={SKILL_LIMITS.descriptionMax}
          aria-invalid={invalidFields.has("description") || undefined}
          className={cn(FIELD_BOX_CLASS, "mt-1", borderClass("description"))}
        />
        <p className={hintClass("description")}>
          {m.assistant_skills_description_hint()}
        </p>
      </div>

      <div>
        <label htmlFor={`${fieldId}-body`} className={labelClass}>
          {m.assistant_skills_body_label()}
        </label>
        <textarea
          id={`${fieldId}-body`}
          value={values.body}
          onChange={(event) => setField("body", event.target.value)}
          maxLength={SKILL_LIMITS.bodyMax}
          rows={14}
          aria-invalid={invalidFields.has("body") || undefined}
          spellCheck={false}
          className={cn(
            FIELD_BOX_CLASS,
            "mt-1 resize-y font-mono text-[13px] leading-relaxed",
            borderClass("body"),
          )}
        />
        <p className={hintClass("body")}>{m.assistant_skills_body_hint()}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={isSaving}>
          {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
          {m.assistant_skills_save()}
        </Button>
        {onDelete &&
          (isConfirmingDelete ? (
            <div className="flex items-center gap-1 rounded-md bg-[var(--parchment-warm)] px-2 py-1">
              <span className="text-xs text-[var(--ink-soft)]">
                {m.assistant_skills_delete_confirm()}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={onDelete}
                disabled={isDeleting}
                aria-label={m.assistant_skills_delete()}
                title={m.assistant_skills_delete()}
              >
                {isDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5 text-[var(--sienna)]" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setIsConfirmingDelete(false)}
                aria-label={m.cancel()}
                title={m.cancel()}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsConfirmingDelete(true)}
              className="text-[var(--sienna)] hover:text-[var(--sienna)]"
            >
              <Trash2 className="h-4 w-4" />
              {m.assistant_skills_delete()}
            </Button>
          ))}
      </div>
    </form>
  );
}

interface SkillRowProps {
  skill: SkillSummary;
  isActive: boolean;
  isToggling: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
}

/** 列表行。选中态沿用会话列表的左侧棕色细线记号 */
function SkillRow({
  skill,
  isActive,
  isToggling,
  onSelect,
  onToggle,
}: SkillRowProps) {
  return (
    <li
      className={cn(
        "flex items-start gap-2 rounded-md border-l-2 py-2 pr-2 pl-2 transition-colors",
        isActive
          ? "border-[var(--academic-brown)]/70 bg-[var(--parchment-warm)]"
          : "border-transparent hover:bg-[var(--parchment-warm)]/60",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={isActive ? "true" : undefined}
        className="min-w-0 flex-1 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:outline-none"
      >
        <span
          className={cn(
            "block truncate font-mono text-sm",
            skill.enabled ? "text-[var(--ink)]" : "text-[var(--ink-soft)]",
          )}
        >
          /{skill.name}
        </span>
        <span className="mt-0.5 line-clamp-2 text-xs leading-snug text-[var(--ink-soft)]">
          {skill.description}
        </span>
      </button>
      <Switch
        size="sm"
        checked={skill.enabled}
        onCheckedChange={onToggle}
        disabled={isToggling}
        aria-label={`${m.assistant_skills_enabled()}: ${skill.name}`}
        className="mt-1"
      />
    </li>
  );
}

/** 导入对话框：只解析、不落库；成功后把三个字段交给父级灌进新建表单 */
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

function AssistantSkillsPage() {
  const { session, isSessionPending } = useRequireAuth("/assistant/skills");
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  /** null = 新建态；否则右栏编辑这一条 */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 新建表单的重挂计数：再点「新建」或导入成功都 +1，把 key 换掉从头开始 */
  const [draftVersion, setDraftVersion] = useState(0);
  /** 导入解析出的三个字段，作为下一个新建表单的初始值 */
  const [importDraft, setImportDraft] = useState<SkillInput | null>(null);

  const listQuery = useQuery({
    ...trpc.skills.list.queryOptions(),
    enabled: !!session,
  });
  const skills = listQuery.data;

  const getQuery = useQuery({
    ...trpc.skills.get.queryOptions({ id: selectedId ?? "" }),
    enabled: !!session && !!selectedId,
  });

  const invalidateList = () =>
    void queryClient.invalidateQueries({
      queryKey: trpc.skills.list.queryKey(),
    });

  const startNewDraft = (draft: SkillInput | null) => {
    setSelectedId(null);
    setImportDraft(draft);
    setDraftVersion((version) => version + 1);
  };

  const createMutation = useMutation(
    trpc.skills.create.mutationOptions({
      onSuccess: (row) => {
        invalidateList();
        toast.success(m.assistant_skills_saved());
        // 转入编辑态：get 拉回整行，表单以库里那份为准重挂
        setImportDraft(null);
        setSelectedId(row.id);
      },
      onError: (error) => toast.error(resolveSkillErrorMessage(error)),
    }),
  );

  const updateMutation = useMutation(
    trpc.skills.update.mutationOptions({
      onSuccess: (_result, variables) => {
        invalidateList();
        void queryClient.invalidateQueries({
          queryKey: trpc.skills.get.queryKey({ id: variables.id }),
        });
        // 列表 enabled 开关也走 update：只有编辑器保存（带 body）才弹「已保存」
        if (variables.body != null) toast.success(m.assistant_skills_saved());
      },
      onError: (error) => toast.error(resolveSkillErrorMessage(error)),
    }),
  );

  const deleteMutation = useMutation(
    trpc.skills.delete.mutationOptions({
      onSuccess: (_result, variables) => {
        invalidateList();
        // 这条的 get 缓存直接移除：invalidate 会促发一次注定 NOT_FOUND 的重取
        queryClient.removeQueries({
          queryKey: trpc.skills.get.queryKey({ id: variables.id }),
        });
        if (variables.id === selectedId) startNewDraft(null);
      },
      onError: (error) => toast.error(resolveSkillErrorMessage(error)),
    }),
  );

  const handleSave = (values: SkillInput) => {
    if (selectedId) updateMutation.mutate({ id: selectedId, ...values });
    else createMutation.mutate(values);
  };

  // 列表开关也走 update，但不该让编辑器的保存按钮跟着转圈：只认带 body 的那次
  const isEditorSaving =
    createMutation.isPending ||
    (updateMutation.isPending && updateMutation.variables?.body != null);

  if (isSessionPending) {
    return (
      <main className="page-wrap flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--academic-brown)]" />
      </main>
    );
  }

  // 未登录会被 useRequireAuth 送去登录页，这里不渲染任何东西
  if (!session) return null;

  const selectedSkill = selectedId ? getQuery.data : null;

  // 右栏三种落点：编辑/新建表单、get 失败、get 加载中
  const editorPane = (() => {
    if (!selectedId || selectedSkill) {
      return (
        <SkillEditor
          // 换选中项 / 新建 / 导入都换 key：重挂即回填，绕开受控表单竞态
          key={selectedId ?? `new-${draftVersion}`}
          initial={
            selectedSkill
              ? {
                  name: selectedSkill.name,
                  description: selectedSkill.description,
                  body: selectedSkill.body,
                }
              : (importDraft ?? EMPTY_FORM)
          }
          isSaving={isEditorSaving}
          isDeleting={deleteMutation.isPending}
          onSave={handleSave}
          onDelete={
            selectedId
              ? () => {
                  if (deleteMutation.isPending) return;
                  deleteMutation.mutate({ id: selectedId });
                }
              : undefined
          }
        />
      );
    }
    if (getQuery.isError) {
      return (
        <div className="flex flex-col items-start gap-3 py-8">
          <p className="text-sm text-[var(--ink-soft)]">
            {resolveSkillErrorMessage(getQuery.error)}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void getQuery.refetch()}
          >
            {m.assistant_history_retry()}
          </Button>
        </div>
      );
    }
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--academic-brown)]" />
      </div>
    );
  })();

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
          <h1 className="font-serif text-2xl text-[var(--ink)]">
            {m.assistant_skills_title()}
          </h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--ink-soft)]">
            {m.assistant_skills_subtitle()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => startNewDraft(null)}
          >
            <Plus className="h-4 w-4" />
            {m.assistant_skills_new()}
          </Button>
          <ImportSkillDialog onApply={(value) => startNewDraft(value)} />
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-6 md:flex-row">
        <aside className="md:w-[280px] md:shrink-0 md:border-r md:border-[var(--line)] md:pr-5">
          {listQuery.isPending ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--academic-brown)]" />
            </div>
          ) : listQuery.isError ? (
            <div className="flex flex-col items-start gap-3 py-2">
              <p className="text-sm leading-relaxed text-[var(--ink-soft)]">
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
          ) : (skills?.length ?? 0) === 0 ? (
            <p className="py-2 text-sm leading-relaxed text-[var(--ink-soft)]">
              {m.assistant_skills_empty()}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {skills?.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  isActive={skill.id === selectedId}
                  isToggling={
                    updateMutation.isPending &&
                    updateMutation.variables?.id === skill.id
                  }
                  onSelect={() => {
                    setSelectedId(skill.id);
                    setImportDraft(null);
                  }}
                  onToggle={(enabled) =>
                    updateMutation.mutate({ id: skill.id, enabled })
                  }
                />
              ))}
            </ul>
          )}
        </aside>
        <section className="min-w-0 flex-1">{editorPane}</section>
      </div>
    </main>
  );
}
