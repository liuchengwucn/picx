import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Link as LinkIcon, Loader2, Upload } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "#/components/ui/accordion";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { useTRPC } from "#/integrations/trpc/react";
import { authClient, startGitHubSignIn } from "#/lib/auth-client";
import {
  getReviewGuestClientSession,
  isReviewGuestModeEnabled,
  isReviewGuestReadOnlySession,
} from "#/lib/review-guest";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

// 前端预检，避免大文件传完才被服务端拒绝；与 /api/papers/upload 的 100MB 硬上限对齐。
const MAX_FILE_BYTES = 100 * 1024 * 1024;

interface UploadDialogProps {
  credits: number;
  onSuccess?: () => void;
}

interface LanguageSelectorsProps {
  summaryLanguage: "en" | "zh-CN" | "zh-TW" | "ja";
  whiteboardLanguage: "en" | "zh-cn" | "zh-tw" | "ja";
  showWhiteboardLanguage: boolean;
  onSummaryLanguageChange: (value: "en" | "zh-CN" | "zh-TW" | "ja") => void;
  onWhiteboardLanguageChange: (value: "en" | "zh-cn" | "zh-tw" | "ja") => void;
}

function LanguageSelectors({
  summaryLanguage,
  whiteboardLanguage,
  showWhiteboardLanguage,
  onSummaryLanguageChange,
  onWhiteboardLanguageChange,
}: LanguageSelectorsProps) {
  return (
    <div
      className={
        showWhiteboardLanguage
          ? "grid grid-cols-2 gap-3"
          : "grid grid-cols-1 gap-3"
      }
    >
      <div className="space-y-2">
        <Label className="text-sm text-[var(--ink-soft)]">
          {m.upload_summary_language()}
        </Label>
        <Select value={summaryLanguage} onValueChange={onSummaryLanguageChange}>
          <SelectTrigger className="border-[var(--line)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">{m.upload_language_en()}</SelectItem>
            <SelectItem value="zh-CN">{m.upload_language_zh()}</SelectItem>
            <SelectItem value="zh-TW">{m.upload_language_zh_tw()}</SelectItem>
            <SelectItem value="ja">{m.upload_language_ja()}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {showWhiteboardLanguage && (
        <div className="space-y-2 flex flex-col items-end">
          <Label className="text-sm text-[var(--ink-soft)]">
            {m.upload_whiteboard_language()}
          </Label>
          <Select
            value={whiteboardLanguage}
            onValueChange={onWhiteboardLanguageChange}
          >
            <SelectTrigger className="border-[var(--line)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">{m.upload_language_en()}</SelectItem>
              <SelectItem value="zh-cn">{m.upload_language_zh()}</SelectItem>
              <SelectItem value="zh-tw">{m.upload_language_zh_tw()}</SelectItem>
              <SelectItem value="ja">{m.upload_language_ja()}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
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

  return (
    <div className="space-y-3">
      <Label className="text-sm text-[var(--ink-soft)]">
        {m.upload_select_api_config()}
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
          <SelectTrigger className="border-[var(--line)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {apiConfigs.map((config) => (
              <SelectItem key={config.id} value={config.id}>
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
  selectedPromptId: string | null | undefined;
  prompts: Array<{ id: string; name: string; isDefault: boolean }> | undefined;
  onPromptChange: (value: string | null) => void;
}

function PromptSelector({
  selectedPromptId,
  prompts,
  onPromptChange,
}: PromptSelectorProps) {
  const hasPrompts = prompts && prompts.length > 0;
  const SYSTEM_PROMPT_VALUE = "__system__";

  return (
    <div className="space-y-2">
      <Label className="text-sm text-[var(--ink-soft)]">
        {m.upload_select_prompt_template()}
      </Label>
      <Select
        value={selectedPromptId ?? SYSTEM_PROMPT_VALUE}
        onValueChange={(value) => {
          onPromptChange(value === SYSTEM_PROMPT_VALUE ? null : value);
        }}
      >
        <SelectTrigger className="border-[var(--line)]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SYSTEM_PROMPT_VALUE}>
            {m.upload_use_system_prompt()}
          </SelectItem>
          {hasPrompts &&
            prompts.map((prompt) => (
              <SelectItem key={prompt.id} value={prompt.id}>
                {prompt.name}
                {prompt.isDefault && ` (${m.api_config_default()})`}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface WhiteboardToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function WhiteboardToggle({ checked, onCheckedChange }: WhiteboardToggleProps) {
  const toggleId = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={toggleId} className="text-sm cursor-pointer">
        {m.upload_whiteboard_toggle_label()}
      </Label>
      <Switch
        id={toggleId}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function UploadDialog({ credits, onSuccess }: UploadDialogProps) {
  const fileInputId = useId();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [arxivUrl, setArxivUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [generateWhiteboard, setGenerateWhiteboard] = useState(false);
  const [summaryLanguage, setSummaryLanguage] = useState<
    "en" | "zh-CN" | "zh-TW" | "ja"
  >(getLocale() as "en" | "zh-CN" | "zh-TW" | "ja");
  const [whiteboardLanguage, setWhiteboardLanguage] = useState<
    "en" | "zh-cn" | "zh-tw" | "ja"
  >("en");
  const [apiSource, setApiSource] = useState<"system" | "user">("system");
  const [selectedApiConfigId, setSelectedApiConfigId] = useState<
    string | undefined
  >(undefined);
  const [selectedPromptId, setSelectedPromptId] = useState<
    string | null | undefined
  >(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trpc = useTRPC();
  const { data: session } = authClient.useSession();
  const effectiveSession =
    session ??
    (isReviewGuestModeEnabled() ? getReviewGuestClientSession() : null);
  const isReadOnlyGuest = isReviewGuestReadOnlySession(effectiveSession);

  // Fetch user's API configurations
  const { data: apiConfigs } = useQuery({
    ...trpc.apiConfig.list.queryOptions(),
    enabled: !!session,
  });

  // Fetch user's prompt templates
  const { data: prompts } = useQuery({
    ...trpc.whiteboardPrompt.list.queryOptions(),
    enabled: !!session,
  });

  // Set default API source and config when apiConfigs are loaded
  useEffect(() => {
    if (apiConfigs && apiConfigs.length > 0) {
      const defaultConfig = apiConfigs.find((config) => config.isDefault);
      if (defaultConfig) {
        // Only switch to user API if there's a default config
        setApiSource("user");
        setSelectedApiConfigId(defaultConfig.id);
      }
      // If no default config, keep using system API (don't auto-select first config)
    }
  }, [apiConfigs]);

  // Set default prompt when prompts are loaded
  useEffect(() => {
    if (prompts && prompts.length > 0) {
      const defaultPrompt = prompts.find((p) => p.isDefault);
      if (defaultPrompt) {
        setSelectedPromptId(defaultPrompt.id);
      } else {
        // No default prompt, use system default (null)
        setSelectedPromptId(null);
      }
    } else {
      // No custom prompts, use system default (null)
      setSelectedPromptId(null);
    }
  }, [prompts]);

  const createPaper = useMutation(trpc.paper.create.mutationOptions());

  const handleFileUpload = useCallback(async () => {
    if (isReadOnlyGuest) {
      void startGitHubSignIn("/");
      return;
    }
    if (!file) return;
    setUploading(true);
    try {
      const resp = await fetch(
        `/api/papers/upload?filename=${encodeURIComponent(file.name)}`,
        { method: "POST", body: file },
      );
      if (!resp.ok) {
        const err = (await resp.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(err?.error ?? "Upload failed");
      }
      const { r2Key, fileSize } = (await resp.json()) as {
        r2Key: string;
        fileSize: number;
      };

      await createPaper.mutateAsync({
        sourceType: "upload",
        filename: file.name,
        fileSize,
        r2Key,
        language: summaryLanguage,
        whiteboardLanguage,
        apiConfigId: apiSource === "user" ? selectedApiConfigId : undefined,
        promptId: generateWhiteboard
          ? (selectedPromptId ?? undefined)
          : undefined,
        generateWhiteboard,
      });
      setOpen(false);
      setFile(null);
      onSuccess?.();
    } catch (e) {
      console.error("Upload failed:", e);
    } finally {
      setUploading(false);
    }
  }, [
    createPaper,
    file,
    isReadOnlyGuest,
    onSuccess,
    summaryLanguage,
    whiteboardLanguage,
    apiSource,
    selectedApiConfigId,
    selectedPromptId,
    generateWhiteboard,
  ]);

  const handleArxivSubmit = useCallback(async () => {
    if (isReadOnlyGuest) {
      void startGitHubSignIn("/");
      return;
    }
    if (!arxivUrl) return;
    setUploading(true);
    try {
      await createPaper.mutateAsync({
        sourceType: "arxiv",
        arxivUrl,
        filename: arxivUrl.split("/").pop() || "arxiv-paper",
        fileSize: 1, // Placeholder size for arxiv, will be updated after download
        r2Key: `arxiv/${Date.now()}`,
        language: summaryLanguage,
        whiteboardLanguage,
        apiConfigId: apiSource === "user" ? selectedApiConfigId : undefined,
        promptId: generateWhiteboard
          ? (selectedPromptId ?? undefined)
          : undefined,
        generateWhiteboard,
      });
      setOpen(false);
      setArxivUrl("");
      onSuccess?.();
    } catch (e) {
      console.error("arXiv submit failed:", e);
    } finally {
      setUploading(false);
    }
  }, [
    arxivUrl,
    createPaper,
    isReadOnlyGuest,
    onSuccess,
    summaryLanguage,
    whiteboardLanguage,
    apiSource,
    selectedApiConfigId,
    selectedPromptId,
    generateWhiteboard,
  ]);

  const insufficientCredits = credits < 1;
  const willCharge = generateWhiteboard && apiSource === "system";
  const blockedByCredits = willCharge && insufficientCredits;

  const handleDialogOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
  }, []);

  const handleFileSelect = useCallback((selected: File | null) => {
    if (!selected) {
      setFile(null);
      setFileError(null);
      return;
    }
    if (selected.size > MAX_FILE_BYTES) {
      setFile(null);
      setFileError(m.upload_file_size_limit());
      return;
    }
    setFile(selected);
    setFileError(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile?.type === "application/pdf") {
        handleFileSelect(droppedFile);
      }
    },
    [handleFileSelect],
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white">
          <Upload className="mr-2 h-4 w-4" />
          {m.papers_upload()}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px] rounded-3xl border-[var(--line)] bg-[var(--parchment)]">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {m.papers_upload()}
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="file">
          <TabsList className="w-full">
            <TabsTrigger value="file" className="flex-1 gap-1.5">
              <FileText className="h-4 w-4" />
              {m.upload_file_title()}
            </TabsTrigger>
            <TabsTrigger value="arxiv" className="flex-1 gap-1.5">
              <LinkIcon className="h-4 w-4" />
              {m.upload_arxiv_title()}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="mt-4">
            <label
              htmlFor={fileInputId}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--neutral-mid)] p-8 transition-colors hover:border-[var(--academic-brown)] hover:bg-[var(--academic-brown)]/5"
            >
              {file ? (
                <div className="text-center">
                  <FileText className="mx-auto h-10 w-10 text-[var(--academic-brown)]" />
                  <p className="mt-2 text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-[var(--ink-soft)]">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleFileSelect(null);
                      openFilePicker();
                    }}
                    className="mt-2"
                  >
                    {m.upload_change_file()}
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 text-[var(--neutral-mid)]" />
                  <p className="mt-3 text-sm text-[var(--ink-soft)]">
                    {m.upload_drag_hint()}
                  </p>
                  <span className="mt-2 cursor-pointer text-sm font-medium text-[var(--academic-brown)] hover:underline">
                    {m.upload_select_file()}
                  </span>
                  <input
                    ref={fileInputRef}
                    id={fileInputId}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) =>
                      handleFileSelect(e.target.files?.[0] || null)
                    }
                  />
                  <p className="mt-1 text-xs text-[var(--neutral-mid)]">
                    {m.upload_file_size_limit()}
                  </p>
                </>
              )}
            </label>
            {fileError && (
              <p className="mt-2 text-center text-xs text-[var(--sienna)]">
                {fileError}
              </p>
            )}
            <div className="mt-4">
              <WhiteboardToggle
                checked={generateWhiteboard}
                onCheckedChange={setGenerateWhiteboard}
              />
            </div>
            <div className="mt-4">
              <LanguageSelectors
                summaryLanguage={summaryLanguage}
                whiteboardLanguage={whiteboardLanguage}
                showWhiteboardLanguage={generateWhiteboard}
                onSummaryLanguageChange={(value) => setSummaryLanguage(value)}
                onWhiteboardLanguageChange={(value) =>
                  setWhiteboardLanguage(value)
                }
              />
              <p className="mt-2 text-xs text-[var(--ink-soft)]">
                {m.upload_english_image_hint()}
              </p>
            </div>
            <div className="mt-2">
              <Accordion type="single" collapsible>
                <AccordionItem
                  value="advanced"
                  className="border-[var(--line)]"
                >
                  <AccordionTrigger className="text-sm text-[var(--ink-soft)] hover:text-[var(--ink)] hover:no-underline py-2">
                    {m.upload_advanced_settings()}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pb-1">
                    <ApiConfigSelector
                      apiSource={apiSource}
                      selectedApiConfigId={selectedApiConfigId}
                      apiConfigs={apiConfigs}
                      onApiSourceChange={(value) => setApiSource(value)}
                      onApiConfigChange={(value) =>
                        setSelectedApiConfigId(value)
                      }
                    />
                    {generateWhiteboard && (
                      <PromptSelector
                        selectedPromptId={selectedPromptId}
                        prompts={prompts}
                        onPromptChange={(value) => setSelectedPromptId(value)}
                      />
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-[var(--ink-soft)]">
                {m.credits_balance()}: {credits}
              </span>
              <span className="text-[var(--ink-soft)]">
                {willCharge
                  ? m.upload_whiteboard_toggle_cost()
                  : m.upload_free_hint()}
              </span>
            </div>
            <Button
              onClick={handleFileUpload}
              disabled={
                !file ||
                uploading ||
                blockedByCredits ||
                (apiSource === "user" && !selectedApiConfigId)
              }
              className="mt-3 w-full bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white"
            >
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {m.upload_start()}
            </Button>
            {blockedByCredits && (
              <p className="mt-2 text-center text-xs text-[var(--sienna)]">
                {m.error_insufficient_credits()}
              </p>
            )}
          </TabsContent>

          <TabsContent value="arxiv" className="mt-4">
            <Input
              placeholder="https://arxiv.org/abs/2301.12345"
              value={arxivUrl}
              onChange={(e) => setArxivUrl(e.target.value)}
              className="border-[var(--line)]"
            />
            <p className="mt-2 text-xs text-[var(--ink-soft)]">
              {m.upload_arxiv_hint()}
            </p>
            <div className="mt-4">
              <WhiteboardToggle
                checked={generateWhiteboard}
                onCheckedChange={setGenerateWhiteboard}
              />
            </div>
            <div className="mt-4">
              <LanguageSelectors
                summaryLanguage={summaryLanguage}
                whiteboardLanguage={whiteboardLanguage}
                showWhiteboardLanguage={generateWhiteboard}
                onSummaryLanguageChange={(value) => setSummaryLanguage(value)}
                onWhiteboardLanguageChange={(value) =>
                  setWhiteboardLanguage(value)
                }
              />
              <p className="mt-2 text-xs text-[var(--ink-soft)]">
                {m.upload_english_image_hint()}
              </p>
            </div>
            <div className="mt-2">
              <Accordion type="single" collapsible>
                <AccordionItem
                  value="advanced"
                  className="border-[var(--line)]"
                >
                  <AccordionTrigger className="text-sm text-[var(--ink-soft)] hover:text-[var(--ink)] hover:no-underline py-2">
                    {m.upload_advanced_settings()}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pb-1">
                    <ApiConfigSelector
                      apiSource={apiSource}
                      selectedApiConfigId={selectedApiConfigId}
                      apiConfigs={apiConfigs}
                      onApiSourceChange={(value) => setApiSource(value)}
                      onApiConfigChange={(value) =>
                        setSelectedApiConfigId(value)
                      }
                    />
                    {generateWhiteboard && (
                      <PromptSelector
                        selectedPromptId={selectedPromptId}
                        prompts={prompts}
                        onPromptChange={(value) => setSelectedPromptId(value)}
                      />
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-[var(--ink-soft)]">
                {m.credits_balance()}: {credits}
              </span>
              <span className="text-[var(--ink-soft)]">
                {willCharge
                  ? m.upload_whiteboard_toggle_cost()
                  : m.upload_free_hint()}
              </span>
            </div>
            <Button
              onClick={handleArxivSubmit}
              disabled={
                !arxivUrl ||
                uploading ||
                blockedByCredits ||
                (apiSource === "user" && !selectedApiConfigId)
              }
              className="mt-3 w-full bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white"
            >
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {m.upload_start()}
            </Button>
            {blockedByCredits && (
              <p className="mt-2 text-center text-xs text-[var(--sienna)]">
                {m.error_insufficient_credits()}
              </p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
