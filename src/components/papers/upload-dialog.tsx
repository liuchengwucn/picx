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

interface UploadDialogProps {
  credits: number;
  onSuccess?: () => void;
}

interface LanguageSelectorsProps {
  summaryLanguage: "en" | "zh-CN" | "zh-TW" | "ja";
  whiteboardLanguage: "en" | "zh-cn" | "zh-tw" | "ja";
  onSummaryLanguageChange: (value: "en" | "zh-CN" | "zh-TW" | "ja") => void;
  onWhiteboardLanguageChange: (value: "en" | "zh-cn" | "zh-tw" | "ja") => void;
}

function LanguageSelectors({
  summaryLanguage,
  whiteboardLanguage,
  onSummaryLanguageChange,
  onWhiteboardLanguageChange,
}: LanguageSelectorsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
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

export function UploadDialog({ credits, onSuccess }: UploadDialogProps) {
  const fileInputId = useId();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [arxivUrl, setArxivUrl] = useState("");
  const [uploading, setUploading] = useState(false);
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

  const uploadFile = useMutation(trpc.upload.uploadFile.mutationOptions());
  const createPaper = useMutation(trpc.paper.create.mutationOptions());

  const handleFileUpload = useCallback(async () => {
    if (isReadOnlyGuest) {
      void startGitHubSignIn("/");
      return;
    }
    if (!file) return;
    setUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const fileData = btoa(binary);

      const { r2Key } = await uploadFile.mutateAsync({
        filename: file.name,
        fileData,
        fileSize: file.size,
      });

      await createPaper.mutateAsync({
        sourceType: "upload",
        filename: file.name,
        fileSize: file.size,
        r2Key,
        language: summaryLanguage,
        whiteboardLanguage,
        apiConfigId: apiSource === "user" ? selectedApiConfigId : undefined,
        promptId: selectedPromptId ?? undefined,
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
    uploadFile,
    whiteboardLanguage,
    apiSource,
    selectedApiConfigId,
    selectedPromptId,
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
        promptId: selectedPromptId ?? undefined,
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
  ]);

  const insufficientCredits = credits < 1;

  const handleDialogOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type === "application/pdf") {
      setFile(droppedFile);
    }
  }, []);

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
                      setFile(null);
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
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                  <p className="mt-1 text-xs text-[var(--neutral-mid)]">
                    {m.upload_file_size_limit()}
                  </p>
                </>
              )}
            </label>
            <div className="mt-4">
              <LanguageSelectors
                summaryLanguage={summaryLanguage}
                whiteboardLanguage={whiteboardLanguage}
                onSummaryLanguageChange={(value) => setSummaryLanguage(value)}
                onWhiteboardLanguageChange={(value) =>
                  setWhiteboardLanguage(value)
                }
              />
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
                    <PromptSelector
                      selectedPromptId={selectedPromptId}
                      prompts={prompts}
                      onPromptChange={(value) => setSelectedPromptId(value)}
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-[var(--ink-soft)]">
                {m.credits_balance()}: {credits}
              </span>
              {apiSource === "system" && (
                <span className="text-[var(--ink-soft)]">
                  {m.upload_cost()}: 1
                </span>
              )}
            </div>
            <Button
              onClick={handleFileUpload}
              disabled={
                !file ||
                uploading ||
                (apiSource === "system" && insufficientCredits) ||
                (apiSource === "user" && !selectedApiConfigId)
              }
              className="mt-3 w-full bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white"
            >
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {m.upload_start()}
            </Button>
            {apiSource === "system" && insufficientCredits && (
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
              <LanguageSelectors
                summaryLanguage={summaryLanguage}
                whiteboardLanguage={whiteboardLanguage}
                onSummaryLanguageChange={(value) => setSummaryLanguage(value)}
                onWhiteboardLanguageChange={(value) =>
                  setWhiteboardLanguage(value)
                }
              />
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
                    <PromptSelector
                      selectedPromptId={selectedPromptId}
                      prompts={prompts}
                      onPromptChange={(value) => setSelectedPromptId(value)}
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-[var(--ink-soft)]">
                {m.credits_balance()}: {credits}
              </span>
              {apiSource === "system" && (
                <span className="text-[var(--ink-soft)]">
                  {m.upload_cost()}: 1
                </span>
              )}
            </div>
            <Button
              onClick={handleArxivSubmit}
              disabled={
                !arxivUrl ||
                uploading ||
                (apiSource === "system" && insufficientCredits) ||
                (apiSource === "user" && !selectedApiConfigId)
              }
              className="mt-3 w-full bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white"
            >
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {m.upload_start()}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
