import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Zap } from "lucide-react";
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
  }, [apiSource, hasApiConfigs, selectedApiConfigId, apiConfigs, onApiConfigChange]);

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
          <a
            href="/api-configs"
            className="mt-2 inline-block text-sm font-medium text-[var(--academic-brown)] hover:underline"
          >
            {m.upload_go_to_settings()}
          </a>
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
          {prompts &&
            prompts.map((prompt) => (
              <SelectItem
                key={prompt.id}
                value={prompt.id}
                className="hover:bg-[var(--parchment-warm)] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span>{prompt.name}</span>
                  {prompt.isDefault && (
                    <span className="text-xs text-[var(--academic-brown)] font-medium">
                      (Default)
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

  const [selectedPromptValue, setSelectedPromptValue] = useState<string>(
    SYSTEM_PROMPT_VALUE,
  );
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

  // Fetch user profile for credits
  const { data: profile } = useQuery(trpc.user.getProfile.queryOptions());

  // Set default API source and config when apiConfigs are loaded
  useEffect(() => {
    if (apiConfigsData && apiConfigsData.length > 0) {
      const defaultConfig = apiConfigsData.find((config) => config.isDefault);
      if (defaultConfig) {
        setApiSource("user");
        setSelectedApiConfigId(defaultConfig.id);
      } else if (apiSource === "user" && !selectedApiConfigId) {
        // If user selects "user" API but no default is set, select the first one
        setSelectedApiConfigId(apiConfigsData[0].id);
      }
    }
  }, [apiConfigsData, apiSource, selectedApiConfigId]);

  // Set default prompt when prompts are loaded
  useEffect(() => {
    if (promptsData && promptsData.length > 0) {
      const defaultPrompt = promptsData.find((p) => p.isDefault);
      if (defaultPrompt) {
        setSelectedPromptValue(defaultPrompt.id);
      }
    }
  }, [promptsData]);

  const regenerateMutation = useMutation(
    trpc.paper.regenerateWhiteboard.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.paper.getById.queryKey(paperId),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.paper.listWhiteboards.queryKey(paperId),
        });
        onOpenChange(false);
        // Reset form
        setSelectedPromptValue(SYSTEM_PROMPT_VALUE);
        setApiSource("system");
        setSelectedApiConfigId(undefined);
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

  const willConsumeCredit = apiSource === "system";
  const hasEnoughCredits = (profile?.credits ?? 0) >= 1;

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

          {/* Credit Cost Display */}
          <div className="rounded-2xl border-2 border-[var(--line)] bg-gradient-to-br from-[var(--parchment-warm)] to-white/50 p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--academic-brown)]/10">
                <Zap className="h-5 w-5 text-[var(--academic-brown)]" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-[var(--ink)] mb-1">
                  {willConsumeCredit
                    ? m.paper_whiteboard_regenerate_credit_cost()
                    : m.paper_whiteboard_regenerate_no_credit_cost()}
                </h4>
                <p className="text-sm text-[var(--ink-soft)]">
                  {willConsumeCredit
                    ? m.paper_whiteboard_regenerate_credit_info({
                        credits: "1",
                        balance: String(profile?.credits ?? 0),
                      })
                    : m.paper_whiteboard_regenerate_no_credit_info()}
                </p>
                {willConsumeCredit && !hasEnoughCredits && (
                  <p className="text-sm text-[var(--sienna)] font-medium mt-2">
                    ⚠️ Insufficient credits. Please add more credits or use your
                    own API.
                  </p>
                )}
              </div>
            </div>
          </div>

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
                (willConsumeCredit && !hasEnoughCredits) ||
                (apiSource === "user" && !selectedApiConfigId)
              }
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
