import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Label } from "#/components/ui/label";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";
import { WhiteboardQuotaHint } from "./whiteboard-quota-hint";

interface RegenerateWhiteboardDialogProps {
  paperId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ApiConfigSelectorProps {
  apiSource: "system" | "user";
  selectedApiConfigId: string | undefined;
  apiConfigs:
    | Array<{ id: string; name: string; isDefault: boolean }>
    | undefined;
  onApiSourceChange: (value: "system" | "user") => void;
  onApiConfigChange: (value: string) => void;
}

function ApiConfigSelector({
  apiSource,
  selectedApiConfigId,
  apiConfigs,
  onApiSourceChange,
  onApiConfigChange,
}: ApiConfigSelectorProps) {
  const hasApiConfigs = apiConfigs && apiConfigs.length > 0;
  const systemApiId = useId();
  const userApiId = useId();

  // Auto-select first config when switching to user API if none selected
  useEffect(() => {
    if (apiSource === "user" && hasApiConfigs && !selectedApiConfigId) {
      onApiConfigChange(apiConfigs[0].id);
    }
  }, [
    apiSource,
    hasApiConfigs,
    selectedApiConfigId,
    apiConfigs,
    onApiConfigChange,
  ]);

  return (
    <div className="space-y-3">
      <Label className="text-sm font-semibold text-[var(--ink)]">
        {m.paper_whiteboard_regenerate_api_label()}
      </Label>
      <RadioGroup value={apiSource} onValueChange={onApiSourceChange}>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="system" id={systemApiId} />
          <Label htmlFor={systemApiId} className="text-sm cursor-pointer">
            {m.upload_use_system_api()}
          </Label>
        </div>
        {hasApiConfigs && (
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="user" id={userApiId} />
            <Label htmlFor={userApiId} className="text-sm cursor-pointer">
              {m.upload_use_user_api()}
            </Label>
          </div>
        )}
      </RadioGroup>

      {apiSource === "user" && hasApiConfigs && (
        <Select value={selectedApiConfigId} onValueChange={onApiConfigChange}>
          <SelectTrigger className="h-12 border-2 border-[var(--line)] bg-white/50 hover:border-[var(--academic-brown)]/30 transition-colors">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[var(--parchment)] border-[var(--line)]">
            {apiConfigs.map((config) => (
              <SelectItem
                key={config.id}
                value={config.id}
                className="hover:bg-[var(--parchment-warm)] cursor-pointer"
              >
                {config.name}
                {config.isDefault && ` (${m.api_config_default()})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {apiSource === "user" && !hasApiConfigs && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--academic-brown)]/5 p-3">
          <p className="text-sm text-[var(--ink-soft)]">
            {m.upload_no_api_config()}
          </p>
          <Link
            to="/settings/providers"
            className="mt-2 inline-block text-sm font-medium hover:underline"
          >
            <span className="text-[var(--academic-brown)]">
              {m.upload_go_to_settings()}
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}

interface PromptSelectorProps {
  selectedPromptValue: string; // "system" | "existing" | prompt.id
  prompts: Array<{ id: string; name: string; isDefault: boolean }> | undefined;
  onPromptChange: (value: string) => void;
}

function PromptSelector({
  selectedPromptValue,
  prompts,
  onPromptChange,
}: PromptSelectorProps) {
  const SYSTEM_PROMPT_VALUE = "__system__";
  const EXISTING_PROMPT_VALUE = "__existing__";

  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-[var(--ink)]">
        {m.paper_whiteboard_regenerate_prompt_label()}
      </Label>
      <Select value={selectedPromptValue} onValueChange={onPromptChange}>
        <SelectTrigger className="h-12 border-2 border-[var(--line)] bg-white/50 hover:border-[var(--academic-brown)]/30 transition-colors">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-[var(--parchment)] border-[var(--line)]">
          <SelectItem
            value={SYSTEM_PROMPT_VALUE}
            className="hover:bg-[var(--parchment-warm)] cursor-pointer"
          >
            {m.upload_use_system_prompt()}
          </SelectItem>
          <SelectItem
            value={EXISTING_PROMPT_VALUE}
            className="hover:bg-[var(--parchment-warm)] cursor-pointer"
          >
            {m.paper_whiteboard_regenerate_use_same()}
          </SelectItem>
          {prompts?.map((prompt) => (
            <SelectItem
              key={prompt.id}
              value={prompt.id}
              className="hover:bg-[var(--parchment-warm)] cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <span>{prompt.name}</span>
                {prompt.isDefault && (
                  <span className="text-xs text-[var(--academic-brown)] font-medium">
                    ({m.api_config_default()})
                  </span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function RegenerateWhiteboardDialog({
  paperId,
  open,
  onOpenChange,
}: RegenerateWhiteboardDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const SYSTEM_PROMPT_VALUE = "__system__";
  const EXISTING_PROMPT_VALUE = "__existing__";

  const [selectedPromptValue, setSelectedPromptValue] =
    useState<string>(SYSTEM_PROMPT_VALUE);
  const [apiSource, setApiSource] = useState<"system" | "user">("system");
  const [selectedApiConfigId, setSelectedApiConfigId] = useState<
    string | undefined
  >(undefined);

  // Fetch user's prompts
  const { data: promptsData } = useQuery(
    trpc.whiteboardPrompt.list.queryOptions(),
  );

  // Fetch user's API configs
  const { data: apiConfigsData } = useQuery(trpc.apiConfig.list.queryOptions());

  // Fetch user profile for the remaining whiteboard allowance
  const {
    data: profile,
    isPending: profilePending,
    isError: profileFailed,
  } = useQuery(trpc.user.getProfile.queryOptions());

  // Reset form state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedPromptValue(SYSTEM_PROMPT_VALUE);
      setApiSource("system");
      setSelectedApiConfigId(undefined);
    }
  }, [open]);

  // Auto-select default API config when user manually switches to user API
  useEffect(() => {
    if (
      apiSource === "user" &&
      apiConfigsData &&
      apiConfigsData.length > 0 &&
      !selectedApiConfigId
    ) {
      const defaultConfig = apiConfigsData.find((config) => config.isDefault);
      if (defaultConfig) {
        setSelectedApiConfigId(defaultConfig.id);
      } else {
        setSelectedApiConfigId(apiConfigsData[0].id);
      }
    }
  }, [apiSource, apiConfigsData, selectedApiConfigId]);

  const regenerateMutation = useMutation(
    trpc.paper.regenerateWhiteboard.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.paper.getById.queryKey(paperId),
        });
        // 详情页的「生成中」反馈来自 getByShortId.paper.whiteboardRegenerating，
        // 不在这里失效就要等到下一次 SSE 才有反馈，按钮期间还能重复点击（重复扣分）。
        queryClient.invalidateQueries({
          queryKey: trpc.paper.getByShortId.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.paper.listWhiteboards.queryKey(paperId),
        });
        onOpenChange(false);
        // Note: The whiteboard will be regenerated in the background
        // The UI will update automatically via SSE when it's ready
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let promptId: string | undefined;
    let useExistingPrompt = false;

    if (selectedPromptValue === EXISTING_PROMPT_VALUE) {
      useExistingPrompt = true;
    } else if (
      selectedPromptValue !== SYSTEM_PROMPT_VALUE &&
      selectedPromptValue !== EXISTING_PROMPT_VALUE
    ) {
      promptId = selectedPromptValue;
    }

    regenerateMutation.mutate({
      paperId,
      promptId,
      useExistingPrompt,
      apiConfigId: apiSource === "user" ? selectedApiConfigId : undefined,
    });
  };

  const remaining = profile?.credits ?? 0;
  const hasApiConfigs = !!apiConfigsData && apiConfigsData.length > 0;
  // 还没查回来、以及查失败，都算「不知道还剩几张」：宁可放行让服务端去判，
  // 也不能凭一个还没到手的数字把提交按钮锁死——一次网络抖动就告诉用户额度没了，
  // 正是这次改版要消灭的焦虑（见 WhiteboardQuotaHint 里 loading 分支的说明）。
  const allowanceUnknown = profilePending || profileFailed;
  const exhausted =
    apiSource === "system" && !allowanceUnknown && remaining < 1;
  const quotaHintId = useId();

  const useOwnApi = () => {
    if (!hasApiConfigs || !apiConfigsData) return;
    const preferred =
      apiConfigsData.find((c) => c.isDefault) ?? apiConfigsData[0];
    setApiSource("user");
    setSelectedApiConfigId(preferred.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-[var(--parchment)] border-[var(--line)]">
        <DialogHeader>
          <DialogTitle className="font-serif text-3xl font-bold text-[var(--ink)] tracking-tight">
            {m.paper_whiteboard_regenerate_title()}
          </DialogTitle>
          <DialogDescription className="text-[var(--ink-soft)] mt-2">
            {m.paper_whiteboard_regenerate_description()}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          {/* Prompt Selection */}
          <PromptSelector
            selectedPromptValue={selectedPromptValue}
            prompts={promptsData}
            onPromptChange={setSelectedPromptValue}
          />

          {/* API Configuration */}
          <ApiConfigSelector
            apiSource={apiSource}
            selectedApiConfigId={selectedApiConfigId}
            apiConfigs={apiConfigsData}
            onApiSourceChange={setApiSource}
            onApiConfigChange={setSelectedApiConfigId}
          />

          {/* Hint */}
          <p className="text-xs text-[var(--ink-soft)]">
            {m.upload_english_image_hint()}
          </p>

          <WhiteboardQuotaHint
            id={quotaHintId}
            remaining={remaining}
            apiSource={apiSource}
            hasApiConfigs={hasApiConfigs}
            onUseOwnApi={useOwnApi}
            loading={allowanceUnknown}
          />

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-[var(--line)]/30">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={regenerateMutation.isPending}
              className="flex-1 h-12 border-[var(--line)] hover:bg-[var(--parchment-warm)]"
            >
              {m.cancel()}
            </Button>
            <Button
              type="submit"
              disabled={
                regenerateMutation.isPending ||
                exhausted ||
                (apiSource === "user" && !selectedApiConfigId)
              }
              // 这个对话框没有开关，禁用的解释只能挂在提交按钮上；
              // 指向常驻可见的额度提示，而不是 title（禁用控件收不到指针事件）
              aria-describedby={exhausted ? quotaHintId : undefined}
              className="flex-1 h-12 bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white shadow-lg hover:shadow-xl transition-all"
            >
              {regenerateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {m.paper_whiteboard_regenerating()}
                </>
              ) : (
                m.paper_whiteboard_regenerate_submit()
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
