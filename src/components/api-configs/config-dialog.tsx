import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  Key,
  Loader2,
  Star,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";
import styles from "./config-dialog.module.css";

interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configId?: string;
  onSuccess?: () => void;
}

interface FormValues {
  name: string;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  geminiApiKey: string;
  geminiBaseUrl: string;
  geminiModel: string;
  isDefault: boolean;
}

export function ConfigDialog({
  open,
  onOpenChange,
  configId,
  onSuccess,
}: ConfigDialogProps) {
  const trpc = useTRPC();
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<{
    openai?: "success" | "failed" | "testing";
    gemini?: "success" | "failed" | "testing";
  }>({});

  // Load existing config if editing
  const configQuery = useQuery({
    ...trpc.apiConfig.getById.queryOptions(configId ?? ""),
    enabled: !!configId,
  });

  const createMutation = useMutation(trpc.apiConfig.create.mutationOptions());
  const updateMutation = useMutation(trpc.apiConfig.update.mutationOptions());
  const testMutation = useMutation(trpc.apiConfig.test.mutationOptions());

  const form = useForm<FormValues>({
    defaultValues: {
      name: "",
      openaiApiKey: "",
      openaiBaseUrl: "https://api.openai.com/v1",
      openaiModel: "gpt-4o-mini",
      geminiApiKey: "",
      geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      geminiModel: "gemini-3.1-flash-image-preview",
      isDefault: false,
    },
    onSubmit: async ({ value }) => {
      try {
        if (configId) {
          await updateMutation.mutateAsync({
            id: configId,
            ...value,
          });
          toast.success(m.api_config_updated());
        } else {
          await createMutation.mutateAsync(value);
          toast.success(m.api_config_created());
        }
        onOpenChange(false);
        onSuccess?.();
      } catch {
        toast.error(
          configId
            ? m.api_config_update_failed()
            : m.api_config_create_failed(),
        );
      }
    },
  });

  // Load config data when editing, or reset to defaults when creating
  useEffect(() => {
    if (open) {
      if (configQuery.data) {
        // Editing: load saved config
        form.setFieldValue("name", configQuery.data.name);
        form.setFieldValue("openaiApiKey", configQuery.data.openaiApiKey);
        form.setFieldValue("openaiBaseUrl", configQuery.data.openaiBaseUrl);
        form.setFieldValue("openaiModel", configQuery.data.openaiModel);
        form.setFieldValue("geminiApiKey", configQuery.data.geminiApiKey);
        form.setFieldValue("geminiBaseUrl", configQuery.data.geminiBaseUrl);
        form.setFieldValue("geminiModel", configQuery.data.geminiModel);
        form.setFieldValue("isDefault", configQuery.data.isDefault);
      } else if (!configId) {
        // Creating: reset to defaults
        form.reset();
      }
      // Clear test status when dialog opens
      setTestStatus({});
    }
  }, [open, configQuery.data, configId, form]);

  const handleTest = async () => {
    const values = form.state.values;

    setTestStatus({
      openai: "testing",
      gemini: "testing",
    });

    try {
      const result = await testMutation.mutateAsync({
        id: configId,
        openaiApiKey: values.openaiApiKey || undefined,
        openaiBaseUrl: values.openaiBaseUrl || undefined,
        openaiModel: values.openaiModel || undefined,
        geminiApiKey: values.geminiApiKey || undefined,
        geminiBaseUrl: values.geminiBaseUrl || undefined,
        geminiModel: values.geminiModel || undefined,
      });

      setTestStatus({
        openai: result.openaiStatus,
        gemini: result.geminiStatus,
      });

      const hasErrors = result.errors?.openai || result.errors?.gemini;
      if (hasErrors) {
        const errorMsg = [
          result.errors?.openai && `OpenAI: ${result.errors.openai}`,
          result.errors?.gemini && `Gemini: ${result.errors.gemini}`,
        ]
          .filter(Boolean)
          .join("; ");
        toast.error(errorMsg);
      } else {
        toast.success(m.api_config_test_success());
      }
    } catch {
      setTestStatus({
        openai: "failed",
        gemini: "failed",
      });
      toast.error(m.api_config_test_failed());
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;
  const isTesting = testMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`sm:max-w-[680px] max-h-[90vh] overflow-y-auto rounded-3xl border-[var(--line)] bg-[var(--parchment)] ${styles.dialogContent}`}
      >
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl text-[var(--ink)] flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--academic-brown)] to-[var(--gold)] shadow-lg">
              <Key className="h-5 w-5 text-white" />
            </div>
            {configId ? m.api_config_edit() : m.api_config_create()}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-6 mt-4"
        >
          {/* Configuration Name */}
          <div className={`space-y-2 ${styles.fieldGroup}`}>
            <form.Field name="name">
              {(field) => (
                <>
                  <Label className="text-sm font-medium text-[var(--ink)]">
                    {m.api_config_name()}
                  </Label>
                  <Input
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={m.api_config_name_placeholder()}
                    className="border-[var(--line)]"
                  />
                </>
              )}
            </form.Field>
          </div>

          {/* OpenAI Configuration */}
          <div
            className={`space-y-4 p-5 rounded-xl bg-[var(--parchment-warm)]/50 border border-[var(--line)] ${styles.configSection}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--academic-brown)]/10">
                  <Cpu className="h-4 w-4 text-[var(--academic-brown)]" />
                </div>
                <span className="text-sm font-semibold text-[var(--ink)] uppercase tracking-wide">
                  {m.openai_config()}
                </span>
              </div>
              {testStatus.openai && (
                <TestStatusIndicator status={testStatus.openai} />
              )}
            </div>

            <div className="grid gap-4">
              <form.Field name="openaiApiKey">
                {(field) => (
                  <div className="space-y-2">
                    <Label className="text-xs text-[var(--ink-soft)] flex items-center gap-1.5">
                      <Key className="h-3 w-3" />
                      {m.openai_api_key()}
                    </Label>
                    <div className="relative">
                      <Input
                        type={showOpenaiKey ? "text" : "password"}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="sk-..."
                        className="border-[var(--line)] pr-10 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink-soft)] hover:text-[var(--ink)] transition-colors"
                      >
                        {showOpenaiKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </form.Field>

              <form.Field name="openaiBaseUrl">
                {(field) => (
                  <div className="space-y-2">
                    <Label className="text-xs text-[var(--ink-soft)] flex items-center gap-1.5">
                      <Globe className="h-3 w-3" />
                      {m.openai_base_url()}
                    </Label>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="https://api.openai.com/v1"
                      className="border-[var(--line)] font-mono text-sm"
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="openaiModel">
                {(field) => (
                  <div className="space-y-2">
                    <Label className="text-xs text-[var(--ink-soft)] flex items-center gap-1.5">
                      <Cpu className="h-3 w-3" />
                      {m.openai_model()}
                    </Label>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="gpt-4o-mini"
                      className="border-[var(--line)] font-mono text-sm"
                    />
                  </div>
                )}
              </form.Field>
            </div>
          </div>

          {/* Gemini Configuration */}
          <div
            className={`space-y-4 p-5 rounded-xl bg-[var(--parchment-warm)]/50 border border-[var(--line)] ${styles.configSection}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--gold)]/10">
                  <Cpu className="h-4 w-4 text-[var(--academic-brown-deep)]" />
                </div>
                <span className="text-sm font-semibold text-[var(--ink)] uppercase tracking-wide">
                  {m.gemini_config()}
                </span>
              </div>
              {testStatus.gemini && (
                <TestStatusIndicator status={testStatus.gemini} />
              )}
            </div>

            <div className="grid gap-4">
              <form.Field name="geminiApiKey">
                {(field) => (
                  <div className="space-y-2">
                    <Label className="text-xs text-[var(--ink-soft)] flex items-center gap-1.5">
                      <Key className="h-3 w-3" />
                      {m.gemini_api_key()}
                    </Label>
                    <div className="relative">
                      <Input
                        type={showGeminiKey ? "text" : "password"}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="AIza..."
                        className="border-[var(--line)] pr-10 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGeminiKey(!showGeminiKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink-soft)] hover:text-[var(--ink)] transition-colors"
                      >
                        {showGeminiKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </form.Field>

              <form.Field name="geminiBaseUrl">
                {(field) => (
                  <div className="space-y-2">
                    <Label className="text-xs text-[var(--ink-soft)] flex items-center gap-1.5">
                      <Globe className="h-3 w-3" />
                      {m.gemini_base_url()}
                    </Label>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="https://generativelanguage.googleapis.com/v1beta"
                      className="border-[var(--line)] font-mono text-sm"
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="geminiModel">
                {(field) => (
                  <div className="space-y-2">
                    <Label className="text-xs text-[var(--ink-soft)] flex items-center gap-1.5">
                      <Cpu className="h-3 w-3" />
                      {m.gemini_model()}
                    </Label>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="gemini-3.1-flash-image-preview"
                      className="border-[var(--line)] font-mono text-sm"
                    />
                  </div>
                )}
              </form.Field>
            </div>
          </div>
          {/* Default Configuration Toggle */}
          <form.Field name="isDefault">
            {(field) => (
              <label
                className={`flex items-center gap-3 p-4 rounded-xl border border-[var(--line)] cursor-pointer transition-all hover:border-[var(--gold)] hover:bg-[var(--gold)]/5 ${field.state.value ? "bg-gradient-to-r from-[var(--gold)]/10 to-transparent border-[var(--gold)]" : ""} ${styles.defaultToggle}`}
              >
                <input
                  type="checkbox"
                  checked={field.state.value}
                  onChange={(e) => field.handleChange(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-all ${field.state.value ? "bg-gradient-to-br from-[var(--academic-brown)] to-[var(--gold)] border-[var(--gold)]" : "border-[var(--neutral-mid)]"}`}
                >
                  {field.state.value && (
                    <Star className="h-3 w-3 text-white fill-white" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-[var(--ink)]">
                    {m.api_config_set_default()}
                  </div>
                  <div className="text-xs text-[var(--ink-soft)]">
                    {m.api_config_default_description()}
                  </div>
                </div>
              </label>
            )}
          </form.Field>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-4 border-t border-[var(--line)]">
            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={isTesting || isLoading}
              className={`gap-2 border-[var(--academic-brown)] text-[var(--academic-brown)] hover:bg-[var(--academic-brown)]/10 ${styles.testButton}`}
            >
              {isTesting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {m.api_config_testing()}
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" />
                  {m.api_config_test()}
                </>
              )}
            </Button>

            <div className="flex-1" />

            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
              className="border-[var(--line)]"
            >
              {m.api_config_cancel()}
            </Button>

            <Button
              type="submit"
              disabled={isLoading}
              className="gap-2 bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white shadow-[0_4px_16px_rgba(139,111,71,0.24)] hover:shadow-[0_8px_24px_rgba(139,111,71,0.32)] transition-all duration-300"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {m.api_config_save()}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TestStatusIndicator({
  status,
}: {
  status: "success" | "failed" | "testing";
}) {
  if (status === "testing") {
    return (
      <div className={`flex items-center gap-1.5 ${styles.testIndicator}`}>
        <Loader2 className="h-4 w-4 animate-spin text-[var(--academic-brown)]" />
        <span className="text-xs text-[var(--ink-soft)]">
          {m.api_config_testing()}
        </span>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div
        className={`flex items-center gap-1.5 ${styles.testIndicator} ${styles.success}`}
      >
        <CheckCircle2 className="h-4 w-4 text-[var(--olive)]" />
        <span className="text-xs text-[var(--olive)] font-medium">
          {m.api_config_test_status_success()}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-1.5 ${styles.testIndicator} ${styles.failed}`}
    >
      <AlertCircle className="h-4 w-4 text-[var(--sienna)]" />
      <span className="text-xs text-[var(--sienna)] font-medium">
        {m.api_config_test_status_failed()}
      </span>
    </div>
  );
}
