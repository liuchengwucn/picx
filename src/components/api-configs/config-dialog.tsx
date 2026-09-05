import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { ModuleKicker } from "#/components/home/module-kicker";
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
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";

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

type TestState = "success" | "failed" | "testing" | "untested";

/**
 * BYOK 配置的新建 / 编辑弹窗。两组服务商（OpenAI 兼容 + Gemini）各三个字段，
 * 「测试连接」的结果内联在各组标题右侧，不再有独立的状态徽标组件。
 * 后端 procedure 与字段集合与旧版完全一致。
 */
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
    openai?: TestState;
    gemini?: TestState;
  }>({});
  const defaultSwitchId = useId();

  const configQuery = useQuery({
    ...trpc.apiConfig.getById.queryOptions(configId ?? ""),
    enabled: !!configId,
  });

  const createMutation = useMutation(trpc.apiConfig.create.mutationOptions());
  const updateMutation = useMutation(trpc.apiConfig.update.mutationOptions());
  const testMutation = useMutation(trpc.apiConfig.test.mutationOptions());

  const form = useForm({
    defaultValues: {
      name: "",
      openaiApiKey: "",
      openaiBaseUrl: "https://api.openai.com/v1",
      openaiModel: "gpt-4o-mini",
      geminiApiKey: "",
      geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      geminiModel: "gemini-3.1-flash-image-preview",
      isDefault: false,
    } as FormValues,
    onSubmit: async ({ value }) => {
      try {
        if (configId) {
          await updateMutation.mutateAsync({ id: configId, ...value });
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

  useEffect(() => {
    if (!open) return;
    if (configQuery.data) {
      form.setFieldValue("name", configQuery.data.name);
      form.setFieldValue("openaiApiKey", configQuery.data.openaiApiKey);
      form.setFieldValue("openaiBaseUrl", configQuery.data.openaiBaseUrl);
      form.setFieldValue("openaiModel", configQuery.data.openaiModel);
      form.setFieldValue("geminiApiKey", configQuery.data.geminiApiKey);
      form.setFieldValue("geminiBaseUrl", configQuery.data.geminiBaseUrl);
      form.setFieldValue("geminiModel", configQuery.data.geminiModel);
      form.setFieldValue("isDefault", configQuery.data.isDefault);
    } else if (!configId) {
      form.reset();
    }
    setTestStatus({});
    setShowOpenaiKey(false);
    setShowGeminiKey(false);
  }, [open, configQuery.data, configId, form]);

  const handleTest = async () => {
    const values = form.state.values;
    setTestStatus({ openai: "testing", gemini: "testing" });
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
      // 后端对没填的那一侧返回 undefined（不是失败，是压根没测）。落成显式
      // "untested" 而不是让状态消失：否则只填了 OpenAI 的新配置测完会「什么都没
      // 显示 + 弹一句测试成功」，等于谎报 Gemini 也通过了。
      setTestStatus({
        openai: result.openaiStatus ?? "untested",
        gemini: result.geminiStatus ?? "untested",
      });
      const hasErrors = result.errors?.openai || result.errors?.gemini;
      if (hasErrors) {
        toast.error(
          [
            result.errors?.openai && `OpenAI: ${result.errors.openai}`,
            result.errors?.gemini && `Gemini: ${result.errors.gemini}`,
          ]
            .filter(Boolean)
            .join("; "),
        );
      } else {
        toast.success(m.api_config_test_success());
      }
    } catch {
      setTestStatus({ openai: "failed", gemini: "failed" });
      toast.error(m.api_config_test_failed());
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isTesting = testMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col rounded-2xl border-[var(--line)] bg-[var(--parchment)] sm:max-w-[600px]">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="font-serif text-xl text-[var(--ink)]">
            {configId ? m.api_config_edit() : m.api_config_create()}
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--ink-soft)]">
            {m.settings_providers_subtitle()}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="min-h-0 flex-1 space-y-5 overflow-y-auto py-1"
        >
          <form.Field name="name">
            {(field) => (
              <FieldRow label={m.api_config_name()}>
                {(id) => (
                  <Input
                    id={id}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={m.api_config_name_placeholder()}
                    className="h-9 border-[var(--line)]"
                  />
                )}
              </FieldRow>
            )}
          </form.Field>

          <ProviderGroup
            title={m.settings_providers_openai()}
            status={testStatus.openai}
          >
            <form.Field name="openaiApiKey">
              {(field) => (
                <FieldRow label={m.openai_api_key()}>
                  {(id) => (
                    <KeyInput
                      id={id}
                      value={field.state.value}
                      onChange={field.handleChange}
                      shown={showOpenaiKey}
                      onToggle={() => setShowOpenaiKey((v) => !v)}
                      placeholder="sk-..."
                    />
                  )}
                </FieldRow>
              )}
            </form.Field>
            <form.Field name="openaiBaseUrl">
              {(field) => (
                <FieldRow label={m.openai_base_url()}>
                  {(id) => (
                    <Input
                      id={id}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="https://api.openai.com/v1"
                      className="h-9 border-[var(--line)] font-mono text-sm"
                    />
                  )}
                </FieldRow>
              )}
            </form.Field>
            <form.Field name="openaiModel">
              {(field) => (
                <FieldRow label={m.openai_model()}>
                  {(id) => (
                    <Input
                      id={id}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="gpt-4o-mini"
                      className="h-9 border-[var(--line)] font-mono text-sm"
                    />
                  )}
                </FieldRow>
              )}
            </form.Field>
          </ProviderGroup>

          <ProviderGroup
            title={m.settings_providers_gemini()}
            status={testStatus.gemini}
          >
            <form.Field name="geminiApiKey">
              {(field) => (
                <FieldRow label={m.gemini_api_key()}>
                  {(id) => (
                    <KeyInput
                      id={id}
                      value={field.state.value}
                      onChange={field.handleChange}
                      shown={showGeminiKey}
                      onToggle={() => setShowGeminiKey((v) => !v)}
                      placeholder="AIza..."
                    />
                  )}
                </FieldRow>
              )}
            </form.Field>
            <form.Field name="geminiBaseUrl">
              {(field) => (
                <FieldRow label={m.gemini_base_url()}>
                  {(id) => (
                    <Input
                      id={id}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="https://generativelanguage.googleapis.com/v1beta"
                      className="h-9 border-[var(--line)] font-mono text-sm"
                    />
                  )}
                </FieldRow>
              )}
            </form.Field>
            <form.Field name="geminiModel">
              {(field) => (
                <FieldRow label={m.gemini_model()}>
                  {(id) => (
                    <Input
                      id={id}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="gemini-3.1-flash-image-preview"
                      className="h-9 border-[var(--line)] font-mono text-sm"
                    />
                  )}
                </FieldRow>
              )}
            </form.Field>
          </ProviderGroup>

          <form.Field name="isDefault">
            {(field) => (
              <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
                <div>
                  <Label
                    htmlFor={defaultSwitchId}
                    className="text-sm text-[var(--ink)]"
                  >
                    {m.api_config_set_default()}
                  </Label>
                  <p className="text-xs text-[var(--ink-soft)]">
                    {m.api_config_default_description()}
                  </p>
                </div>
                <Switch
                  id={defaultSwitchId}
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                />
              </div>
            )}
          </form.Field>
        </form>

        <DialogFooter className="flex-shrink-0 gap-2 border-t border-[var(--line)] pt-4 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={handleTest}
            disabled={isTesting || isSaving}
            className="h-9 border-[var(--line)]"
          >
            {isTesting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {m.api_config_testing()}
              </>
            ) : (
              m.api_config_test()
            )}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
              className="h-9 text-[var(--ink-soft)]"
            >
              {m.cancel()}
            </Button>
            <Button
              type="button"
              onClick={() => void form.handleSubmit()}
              disabled={isSaving}
              className="h-9 bg-[var(--academic-brown)] text-white hover:bg-[var(--academic-brown-deep)]"
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {m.save()}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * children 收成 (id) => ReactNode 而不是裸 ReactNode：<Label> 与输入框是兄弟节点，
 * 不 htmlFor/id 配对的话这个 <label> 谁也没标注——点它不聚焦，可访问名退化成
 * placeholder。本文件里 Switch 那一处已经是正确写法，文本框不该两套标准。
 */
function FieldRow({
  label,
  children,
}: {
  label: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-[var(--ink-soft)]">
        {label}
      </Label>
      {children(id)}
    </div>
  );
}

/**
 * 一组服务商字段：栏眉 + 内联测试结果 + 三个输入。
 *
 * 用 role="group" + aria-labelledby 而不是 fieldset/legend，有三个理由：legend 上
 * 的 display:flex 各浏览器行为不一；fieldset 默认 min-inline-size:min-content，
 * 里面那条 52 字符的 base URL 占位符会在窄屏撑出横向滚动；而且状态若落在 legend
 * 里就成了整组的可访问名（读作「OpenAI 兼容 通过」并随测试变动）。
 * aria-labelledby 只指向标题那个 span，状态另挂 <output> 自己播报。
 */
function ProviderGroup({
  title,
  status,
  children,
}: {
  title: string;
  status?: TestState;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    // biome-ignore lint/a11y/useSemanticElements: 规则建议的 <fieldset> 正是上面三条理由排除掉的那个元素
    <div role="group" aria-labelledby={labelId} className="min-w-0 space-y-3">
      <ModuleKicker
        color="var(--olive)"
        trailing={status ? <InlineTestStatus status={status} /> : null}
      >
        <span id={labelId}>{title}</span>
      </ModuleKicker>
      {children}
    </div>
  );
}

/**
 * 用 <output> 而不是 span + role="status"：它自带 role=status 与 aria-live=polite，
 * 测试结束时会自动播报（与 pdf-reader-view 里的用法一致）。它同时是这一组表单
 * 字段「算出来的结果」，语义正好对上。
 */
function InlineTestStatus({ status }: { status: TestState }) {
  const className =
    "inline-flex items-center gap-1 normal-case tracking-normal";
  if (status === "testing") {
    return (
      <output className={className}>
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {m.api_config_testing()}
      </output>
    );
  }
  if (status === "untested") {
    return (
      <output className={className}>{m.settings_providers_untested()}</output>
    );
  }
  const ok = status === "success";
  const Icon = ok ? Check : X;
  return (
    <output className={className}>
      <Icon className="h-3 w-3" strokeWidth={1.25} aria-hidden />
      {ok ? m.settings_providers_test_pass() : m.settings_providers_test_fail()}
    </output>
  );
}

/**
 * 密钥输入：右侧「显示 / 隐藏」文字切换，不用眼睛图标（icon-only 按钮不可解释）。
 *
 * aria-pressed 是必须的：弹窗里有两个都叫「显示」的按钮，光靠标签读不出当前
 * 是明文还是密文——切换态得由 pressed 承载，标签只说这个按钮是干什么的。
 */
function KeyInput({
  id,
  value,
  onChange,
  shown,
  onToggle,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  shown: boolean;
  onToggle: () => void;
  placeholder: string;
}) {
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 border-[var(--line)] font-mono text-sm"
        autoComplete="off"
      />
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={shown}
        className="h-9 flex-none px-2 text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
      >
        {shown
          ? m.settings_providers_hide_key()
          : m.settings_providers_show_key()}
      </button>
    </div>
  );
}
