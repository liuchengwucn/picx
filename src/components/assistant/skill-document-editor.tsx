import { Copy, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { SKILL_LIMITS, type SkillInput, skillInputSchema } from "#/lib/skills";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

type SkillFormField = keyof SkillInput;

/** description textarea 的自增高。定义在组件外：不捕获任何渲染态，不进依赖表 */
function autoResizeTextarea(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.style.height = "auto";
  node.style.height = `${node.scrollHeight}px`;
}

interface SkillDocumentEditorProps {
  /** 编辑态与新建态共用同一份表单；差异全部由 headerActions / footer* 注入 */
  initial: SkillInput;
  isSaving: boolean;
  onSave: (values: SkillInput) => void;
  /**
   * 新建页需要即使表单等于 initial（比如导入草稿原样落地、或压根没动过）也能点保存：
   * zod 会拦下真正的问题并标红对应字段，这比一个说不清为什么点不动的灰按钮更清楚。
   * 编辑页不传（默认 false）——已保存的技能没改动时点保存没有意义。
   */
  allowPristineSave?: boolean;
  /** 复制屏幕上这份（而不是磁盘上已保存的那份）；不传则不渲染复制按钮（新建页没有可复制的东西） */
  onCopy?: (values: SkillInput) => void;
  /** 报头右侧的额外操作（开关 / 删除），由路由页提供 */
  headerActions?: React.ReactNode;
  /** 底部左侧的额外信息（更新时间等） */
  footerMeta?: React.ReactNode;
  /** 底部右侧的额外入口（用它开一段对话） */
  footerAction?: React.ReactNode;
}

/**
 * 文档式技能编辑器。技能本来就是一份带 frontmatter 的 Markdown（导入解析的正是
 * 这个格式），所以编辑器直接长成那份文档：`---` 包住 name / description，
 * 下面是正文。`---` 与键名只是版式，三个值仍然是三个受控输入 —— 用户不写 YAML，
 * 因此不存在解析报错这回事。
 */
export function SkillDocumentEditor({
  initial,
  isSaving,
  onSave,
  allowPristineSave = false,
  onCopy,
  headerActions,
  footerMeta,
  footerAction,
}: SkillDocumentEditorProps) {
  const fieldId = useId();
  const [values, setValues] = useState(initial);
  const [invalidFields, setInvalidFields] = useState<
    ReadonlySet<SkillFormField>
  >(new Set());
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

  const dirty =
    values.name !== initial.name ||
    values.description !== initial.description ||
    values.body !== initial.body;

  // description 随内容增高：它是 frontmatter 里的一行，但上限有 1024 字，
  // 固定单行会把长说明藏进横向滚动里。keyed by 内容本身，不是挂载一次——
  // 否则导入草稿、切换技能之类的非用户输入触发的内容变化不会重算。
  // biome-ignore lint/correctness/useExhaustiveDependencies: values.description 是有意保留的「内容变了」信号，节点走 ref 不在依赖表里，autofix 会删掉它并悄悄废掉自动增高
  useEffect(() => {
    autoResizeTextarea(descriptionRef.current);
  }, [values.description]);

  // 上面那个 effect 只在内容变化时重算；窗口变窄、侧栏展开这类不改内容只改
  // 可用宽度的情况不会触发它。这块是 resize-none overflow-hidden，没有滚动条
  // 兜底——不补这个观察器，换行数变多时多出来的内容会被无声裁掉。
  useEffect(() => {
    const node = descriptionRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => autoResizeTextarea(node));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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

  const valueClass = (field: SkillFormField) =>
    cn(
      "min-w-0 flex-1 border-b border-dashed bg-transparent text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]",
      invalidFields.has(field)
        ? "border-[var(--sienna)]"
        : "border-[var(--academic-brown)]/30 focus:border-[var(--academic-brown)]",
    );

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        {headerActions}
        {dirty && (
          <span className="text-[11px] text-[var(--ink-soft)]">
            {m.assistant_skills_unsaved()}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* 复制的是 values（屏幕上这份），不是 initial（磁盘上已保存的那份）——
              未保存的改动点复制也该拿到用户正在看的内容 */}
          {onCopy && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onCopy(values)}
            >
              <Copy className="h-4 w-4" />
              {m.assistant_skills_copy()}
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={isSaving || (!dirty && !allowPristineSave)}
          >
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {m.assistant_skills_save()}
          </Button>
        </div>
      </div>

      {/* 纸张：比页面底色略亮一档，发丝线包边 */}
      <div className="mt-4 rounded-md border border-[var(--line)] bg-[var(--parchment)] px-4 py-4 sm:px-6 sm:py-5">
        <div className="font-mono text-[12.5px] leading-relaxed">
          <p aria-hidden="true" className="text-[var(--ink-soft)]/60">
            ---
          </p>
          <div className="flex items-baseline gap-1">
            <label
              htmlFor={`${fieldId}-name`}
              className="shrink-0 text-[var(--academic-brown)]"
            >
              name:
            </label>
            <input
              id={`${fieldId}-name`}
              value={values.name}
              onChange={(event) => setField("name", event.target.value)}
              maxLength={SKILL_LIMITS.nameMax}
              aria-invalid={invalidFields.has("name") || undefined}
              placeholder={m.assistant_skills_name_hint()}
              autoComplete="off"
              spellCheck={false}
              className={valueClass("name")}
            />
          </div>
          <div className="flex items-baseline gap-1">
            <label
              htmlFor={`${fieldId}-description`}
              className="shrink-0 text-[var(--academic-brown)]"
            >
              description:
            </label>
            <textarea
              id={`${fieldId}-description`}
              ref={descriptionRef}
              rows={1}
              value={values.description}
              onChange={(event) => setField("description", event.target.value)}
              maxLength={SKILL_LIMITS.descriptionMax}
              aria-invalid={invalidFields.has("description") || undefined}
              placeholder={m.assistant_skills_description_hint()}
              className={cn(
                valueClass("description"),
                "resize-none overflow-hidden",
              )}
            />
          </div>
          <p aria-hidden="true" className="text-[var(--ink-soft)]/60">
            ---
          </p>
        </div>

        <textarea
          id={`${fieldId}-body`}
          value={values.body}
          onChange={(event) => setField("body", event.target.value)}
          maxLength={SKILL_LIMITS.bodyMax}
          aria-invalid={invalidFields.has("body") || undefined}
          aria-label={m.assistant_skills_body_label()}
          placeholder={m.assistant_skills_body_hint()}
          spellCheck={false}
          // 移动端不撑满 100dvh：虚拟键盘一弹，撑满高度的布局会被顶乱
          className={cn(
            "mt-4 w-full resize-y bg-transparent font-mono text-[12.5px] leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]",
            "min-h-[50vh] md:min-h-[calc(100dvh-24rem)]",
            invalidFields.has("body") && "outline-1 outline-[var(--sienna)]",
          )}
        />
      </div>

      {invalidFields.size > 0 && (
        <p role="alert" className="mt-2 text-xs text-[var(--sienna)]">
          {m.assistant_skills_invalid()}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ink-soft)]">
        <span className="tabular-nums">
          {values.body.length} / {SKILL_LIMITS.bodyMax}
        </span>
        {footerMeta}
        <span className="ml-auto">{footerAction}</span>
      </div>
    </form>
  );
}
