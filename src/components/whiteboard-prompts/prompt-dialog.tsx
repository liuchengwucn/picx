import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
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
import { Textarea } from "#/components/ui/textarea";
import { useTRPC } from "#/integrations/trpc/react";
import { getSystemDefaultPromptTemplate } from "#/lib/prompt-validation";
import { m } from "#/paraglide/messages";

interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingPromptId?: string;
}

const promptPlaceholderLabels = {
  contentText: "{contentText}",
  whiteboardMarkdown: "{whiteboardMarkdown}",
  languageInstruction: "{languageInstruction}",
} as const;

export function PromptDialog({
  open,
  onOpenChange,
  editingPromptId,
}: PromptDialogProps) {
  const [name, setName] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const trpc = useTRPC();

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
  useEffect(() => {
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
  }, [editingPromptId, promptsQuery.data]);

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
        toast.success(m.whiteboard_prompt_update_success());
      } else {
        await createMutation.mutateAsync({
          name,
          promptTemplate,
          isDefault,
        });
        toast.success(m.whiteboard_prompt_create_success());
      }
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save prompt:", error);
      toast.error(
        editingPromptId
          ? "Failed to update template"
          : "Failed to create template",
      );
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] rounded-2xl border-[var(--line)] bg-[var(--parchment)] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="font-serif text-xl">
            {editingPromptId
              ? m.whiteboard_prompt_edit()
              : m.whiteboard_prompt_create()}
          </DialogTitle>
          <DialogDescription className="text-[var(--ink-soft)]">
            {m.whiteboard_prompt_variables_hint(promptPlaceholderLabels)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 overflow-y-auto flex-1 min-h-0">
          {/* Template Name */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-[var(--ink)]">
              {m.whiteboard_prompt_name()}
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={m.whiteboard_prompt_name_placeholder()}
              className={`border-[var(--line)] ${errors.name ? "border-red-500" : ""}`}
              maxLength={50}
            />
            {errors.name && (
              <p className="text-sm text-red-500">{errors.name}</p>
            )}
            <p className="text-xs text-[var(--ink-soft)]">
              {name.length}/50 characters
            </p>
          </div>

          {/* Prompt Template */}
          <div className="space-y-2">
            <Label htmlFor="promptTemplate" className="text-[var(--ink)]">
              {m.whiteboard_prompt_content()}
            </Label>
            <Textarea
              id="promptTemplate"
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.target.value)}
              placeholder={m.whiteboard_prompt_content_placeholder()}
              rows={8}
              className={`border-[var(--line)] font-mono text-sm resize-none ${errors.promptTemplate ? "border-red-500" : ""}`}
              maxLength={3000}
            />
            {errors.promptTemplate && (
              <p className="text-sm text-red-500">{errors.promptTemplate}</p>
            )}
            <div className="flex items-center justify-between text-xs text-[var(--ink-soft)]">
              <span>
                {m.whiteboard_prompt_content_text_required_hint({
                  contentText: promptPlaceholderLabels.contentText,
                })}
              </span>
              <span>{promptTemplate.length}/3000 characters</span>
            </div>
          </div>

          {/* Set as Default */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="isDefault"
              checked={isDefault}
              onCheckedChange={(checked) => setIsDefault(checked === true)}
            />
            <Label
              htmlFor="isDefault"
              className="text-sm cursor-pointer text-[var(--ink)]"
            >
              {m.whiteboard_prompt_set_default()}
            </Label>
          </div>
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
          <Button
            onClick={handleSave}
            disabled={isLoading}
            className="bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {m.save()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
