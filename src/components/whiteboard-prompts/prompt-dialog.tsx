import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { useTRPC } from "#/integrations/trpc/react";
import { getSystemDefaultPromptTemplate } from "#/lib/prompt-validation";
import { m } from "#/paraglide/messages";

interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingPromptId?: string;
  /** 只读查看内置模板：textarea 只读、无保存按钮、无「设为默认」。 */
  readOnly?: boolean;
  /** 保存成功后回调（调用方据此失效列表）。只在真正写库后触发——挂在关闭上会让
   *  「查看内置模板」和「取消」也各打一次白跑的请求。同 ConfigDialog。 */
  onSuccess?: () => void;
}

const promptPlaceholderLabels = {
  contentText: "{contentText}",
  whiteboardInsights: "{whiteboardInsights}",
  languageInstruction: "{languageInstruction}",
} as const;

export function PromptDialog({
  open,
  onOpenChange,
  editingPromptId,
  readOnly = false,
  onSuccess,
}: PromptDialogProps) {
  const [name, setName] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const trpc = useTRPC();
  const nameInputId = useId();
  const promptTemplateInputId = useId();
  const defaultSwitchId = useId();

  // Fetch prompts list to get editing data
  const promptsQuery = useQuery({
    ...trpc.whiteboardPrompt.list.queryOptions(),
    enabled: !!editingPromptId,
  });

  const createMutation = useMutation(
    trpc.whiteboardPrompt.create.mutationOptions(),
  );
  const updateMutation = useMutation(
    trpc.whiteboardPrompt.update.mutationOptions(),
  );

  // Load editing data or set defaults
  //
  // 依赖里必须带 open：本组件在页面上是常驻的，关掉弹窗只是把 open 置 false，
  // 表单 state 会原样留到下一次打开。只按 editingPromptId 判断的话，「新建 → 改
  // 了正文 → 取消 → 查看内置模板」这条路径上 editingPromptId 一直是 undefined、
  // effect 不重跑，只读弹窗里显示的就是上一次那份没保存的草稿而不是内置模板。
  // 关闭时直接 return（而不是顺手重置）是为了避免关闭动画期间字段闪一下。
  useEffect(() => {
    if (!open) return;
    if (editingPromptId && promptsQuery.data) {
      const prompt = promptsQuery.data.find((p) => p.id === editingPromptId);
      if (prompt) {
        setName(prompt.name);
        setPromptTemplate(prompt.promptTemplate);
        setIsDefault(prompt.isDefault);
      }
    } else if (!editingPromptId) {
      // New prompt - use system default as template
      setName("");
      setPromptTemplate(getSystemDefaultPromptTemplate());
      setIsDefault(false);
    }
    setErrors({});
  }, [open, editingPromptId, promptsQuery.data]);

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = m.whiteboard_prompt_validation_name_required();
    } else if (name.length > 50) {
      newErrors.name = m.whiteboard_prompt_validation_name_length();
    }

    if (!promptTemplate.trim()) {
      newErrors.promptTemplate =
        m.whiteboard_prompt_validation_content_required();
    } else if (promptTemplate.length < 10 || promptTemplate.length > 3000) {
      newErrors.promptTemplate =
        m.whiteboard_prompt_validation_content_length();
    } else {
      const contentTextCount = (promptTemplate.match(/\{contentText\}/g) || [])
        .length;
      if (contentTextCount === 0) {
        newErrors.promptTemplate =
          m.whiteboard_prompt_validation_content_text_required({
            contentText: promptPlaceholderLabels.contentText,
          });
      } else if (contentTextCount > 1) {
        newErrors.promptTemplate =
          m.whiteboard_prompt_validation_content_text_once({
            contentText: promptPlaceholderLabels.contentText,
          });
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;

    try {
      if (editingPromptId) {
        await updateMutation.mutateAsync({
          id: editingPromptId,
          name,
          promptTemplate,
          isDefault,
        });
        onSuccess?.();
        toast.success(m.whiteboard_prompt_update_success());
      } else {
        await createMutation.mutateAsync({
          name,
          promptTemplate,
          isDefault,
        });
        onSuccess?.();
        toast.success(m.whiteboard_prompt_create_success());
      }
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save prompt:", error);
      toast.error(
        editingPromptId
          ? m.whiteboard_prompt_update_failed()
          : m.whiteboard_prompt_create_failed(),
      );
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] rounded-2xl border-[var(--line)] bg-[var(--parchment)] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="font-serif text-xl text-[var(--ink)]">
            {readOnly
              ? m.settings_prompts_builtin()
              : editingPromptId
                ? m.edit()
                : m.create()}
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--ink-soft)]">
            {m.whiteboard_prompt_variables_hint(promptPlaceholderLabels)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 overflow-y-auto flex-1 min-h-0">
          {/* Template Name —— 内置模板没有名字，只读时整块不渲染 */}
          {!readOnly && (
            <div className="space-y-2">
              <Label
                htmlFor={nameInputId}
                className="text-xs text-[var(--ink-soft)]"
              >
                {m.whiteboard_prompt_name()}
              </Label>
              <Input
                id={nameInputId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={m.whiteboard_prompt_name_placeholder()}
                className={`border-[var(--line)] ${errors.name ? "border-[var(--sienna)]" : ""}`}
                maxLength={50}
              />
              {errors.name && (
                <p className="text-sm text-[var(--sienna)]">{errors.name}</p>
              )}
              <p className="text-xs text-[var(--ink-soft)]">
                {name.length}/50 characters
              </p>
            </div>
          )}

          {/* Prompt Template */}
          <div className="space-y-2">
            <Label
              htmlFor={promptTemplateInputId}
              className="text-xs text-[var(--ink-soft)]"
            >
              {m.whiteboard_prompt_content()}
            </Label>
            <Textarea
              id={promptTemplateInputId}
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.target.value)}
              readOnly={readOnly}
              placeholder={m.whiteboard_prompt_content_placeholder()}
              rows={8}
              className={`border-[var(--line)] font-mono text-sm resize-none ${errors.promptTemplate ? "border-[var(--sienna)]" : ""}`}
              maxLength={3000}
            />
            {errors.promptTemplate && (
              <p className="text-sm text-[var(--sienna)]">
                {errors.promptTemplate}
              </p>
            )}
            {/* 占位符规则与字数计数都是写作用的，只读模式下没有可写的对象 */}
            {!readOnly && (
              <div className="flex items-center justify-between text-xs text-[var(--ink-soft)]">
                <span>
                  {m.whiteboard_prompt_content_text_required_hint({
                    contentText: promptPlaceholderLabels.contentText,
                  })}
                </span>
                <span>{promptTemplate.length}/3000 characters</span>
              </div>
            )}
          </div>

          {/* Set as Default —— 与 ConfigDialog 逐字同形的开关行 */}
          {!readOnly && (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
              <div>
                <Label
                  htmlFor={defaultSwitchId}
                  className="text-sm text-[var(--ink)]"
                >
                  {m.whiteboard_prompt_set_default()}
                </Label>
                <p className="text-xs text-[var(--ink-soft)]">
                  {m.whiteboard_prompt_default_description()}
                </p>
              </div>
              <Switch
                id={defaultSwitchId}
                checked={isDefault}
                onCheckedChange={setIsDefault}
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 flex-shrink-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="text-[var(--ink-soft)]"
          >
            {m.cancel()}
          </Button>
          {!readOnly && (
            <Button
              onClick={handleSave}
              disabled={isLoading}
              className="bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {m.save()}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
