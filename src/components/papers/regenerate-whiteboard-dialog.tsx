import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Zap } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Label } from "#/components/ui/label";
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

export function RegenerateWhiteboardDialog({
  paperId,
  open,
  onOpenChange,
}: RegenerateWhiteboardDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [promptId, setPromptId] = useState<string>("");
  const [useExistingPrompt, setUseExistingPrompt] = useState(false);
  const [apiConfigId, setApiConfigId] = useState<string>("system");
  const checkboxId = useId();

  // Fetch user's prompts
  const { data: promptsData } = useQuery(
    trpc.whiteboardPrompt.list.queryOptions(),
  );

  // Fetch user's API configs
  const { data: apiConfigsData } = useQuery(
    trpc.userApiConfig.list.queryOptions(),
  );

  // Fetch user profile for credits
  const { data: profile } = useQuery(trpc.user.getProfile.queryOptions());

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
        setPromptId("");
        setUseExistingPrompt(false);
        setApiConfigId("system");
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    regenerateMutation.mutate({
      paperId,
      promptId: promptId || undefined,
      useExistingPrompt,
      apiConfigId: apiConfigId === "system" ? undefined : apiConfigId,
    });
  };

  const willConsumeCredit = apiConfigId === "system";
  const hasEnoughCredits = (profile?.credits ?? 0) >= 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-[var(--parchment)] border-[var(--line)]">
        <DialogHeader>
          <DialogTitle className="font-serif text-3xl font-bold text-[var(--ink)] tracking-tight flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--academic-brown)] to-[var(--academic-brown-deep)] shadow-lg">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            {m.paper_whiteboard_regenerate_title()}
          </DialogTitle>
          <DialogDescription className="text-[var(--ink-soft)] mt-2">
            Configure options to generate a new whiteboard visualization
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          {/* Prompt Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold text-[var(--ink)] flex items-center gap-2">
              {m.paper_whiteboard_regenerate_prompt_label()}
              <span className="text-xs font-normal text-[var(--ink-soft)]">
                (Optional)
              </span>
            </Label>

            <div className="space-y-3">
              <Select
                value={promptId}
                onValueChange={setPromptId}
                disabled={useExistingPrompt || regenerateMutation.isPending}
              >
                <SelectTrigger className="h-12 border-2 border-[var(--line)] bg-white/50 hover:border-[var(--academic-brown)]/30 transition-colors disabled:opacity-50">
                  <SelectValue placeholder="Select a prompt template..." />
                </SelectTrigger>
                <SelectContent className="bg-[var(--parchment)] border-[var(--line)]">
                  {promptsData?.map((prompt) => (
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

              <div className="flex items-center space-x-2 p-4 rounded-xl border-2 border-[var(--line)] bg-[var(--parchment-warm)]/50 hover:bg-[var(--parchment-warm)] transition-colors">
                <Checkbox
                  id={checkboxId}
                  checked={useExistingPrompt}
                  onCheckedChange={(checked) => {
                    setUseExistingPrompt(checked as boolean);
                    if (checked) setPromptId("");
                  }}
                  disabled={regenerateMutation.isPending}
                  className="border-[var(--academic-brown)] data-[state=checked]:bg-[var(--academic-brown)]"
                />
                <Label
                  htmlFor={checkboxId}
                  className="text-sm text-[var(--ink)] cursor-pointer flex-1"
                >
                  {m.paper_whiteboard_regenerate_use_same()}
                </Label>
              </div>
            </div>
          </div>

          {/* API Configuration */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold text-[var(--ink)] flex items-center gap-2">
              {m.paper_whiteboard_regenerate_api_label()}
              <span className="text-xs font-normal text-[var(--ink-soft)]">
                (Optional)
              </span>
            </Label>

            <Select
              value={apiConfigId}
              onValueChange={setApiConfigId}
              disabled={regenerateMutation.isPending}
            >
              <SelectTrigger className="h-12 border-2 border-[var(--line)] bg-white/50 hover:border-[var(--academic-brown)]/30 transition-colors">
                <SelectValue
                  placeholder={m.paper_whiteboard_regenerate_api_system()}
                />
              </SelectTrigger>
              <SelectContent className="bg-[var(--parchment)] border-[var(--line)]">
                <SelectItem
                  value="system"
                  className="hover:bg-[var(--parchment-warm)]"
                >
                  {m.paper_whiteboard_regenerate_api_system()}
                </SelectItem>
                {apiConfigsData?.map((config) => (
                  <SelectItem
                    key={config.id}
                    value={config.id}
                    className="hover:bg-[var(--parchment-warm)] cursor-pointer"
                  >
                    {config.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
                  {willConsumeCredit ? (
                    <>
                      This will consume{" "}
                      <span className="font-bold text-[var(--academic-brown)]">
                        1 credit
                      </span>
                      . You currently have{" "}
                      <span className="font-bold">
                        {profile?.credits ?? 0} credits
                      </span>
                      .
                    </>
                  ) : (
                    "Using your API configuration. No credits will be consumed."
                  )}
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
                (willConsumeCredit && !hasEnoughCredits)
              }
              className="flex-1 h-12 bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white shadow-lg hover:shadow-xl transition-all"
            >
              {regenerateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {m.paper_whiteboard_regenerating()}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {m.paper_whiteboard_regenerate_submit()}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
