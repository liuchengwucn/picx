import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Link as LinkIcon, Loader2, Upload } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { localizeUploadError } from "#/components/papers/upload-error-message";
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
import { useTRPC } from "#/integrations/trpc/react";
import { canonicalArxivUrl, isArxivLink } from "#/lib/arxiv";
import { authClient, startGitHubSignIn } from "#/lib/auth-client";
import { isAllowedPdfUrl } from "#/lib/pdf-url";
import {
  getReviewGuestClientSession,
  isReviewGuestModeEnabled,
  isReviewGuestReadOnlySession,
} from "#/lib/review-guest";
import { UPLOAD_ERROR } from "#/lib/upload-errors";
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
        <div className="space-y-2">
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

interface UploadOptionsProps
  extends LanguageSelectorsProps,
    ApiConfigSelectorProps,
    PromptSelectorProps {
  generateWhiteboard: boolean;
  onGenerateWhiteboardChange: (checked: boolean) => void;
  credits: number;
  willCharge: boolean;
}

/**
 * 上传选项区。文件与链接两条路径共用同一份选项,与用哪条路径无关。
 *
 * 只有「同时生成白板图」留在外层:它是唯一影响计费的开关,也决定折叠区里
 * 白板图语言、提示词模板还有没有意义。语言选择进折叠区 —— 默认值(摘要跟随
 * 界面语言、白板图英文)对绝大多数人已经是对的,常驻只是让主界面更长。
 * 积分与计费文案同理:不出图就不花钱,没勾选时提计费只会让人以为要付费。
 */
function UploadOptions({
  generateWhiteboard,
  onGenerateWhiteboardChange,
  credits,
  willCharge,
  summaryLanguage,
  whiteboardLanguage,
  showWhiteboardLanguage,
  onSummaryLanguageChange,
  onWhiteboardLanguageChange,
  apiSource,
  selectedApiConfigId,
  apiConfigs,
  onApiSourceChange,
  onApiConfigChange,
  selectedPromptId,
  prompts,
  onPromptChange,
}: UploadOptionsProps) {
  return (
    <>
      <div className="mt-4">
        <WhiteboardToggle
          checked={generateWhiteboard}
          onCheckedChange={onGenerateWhiteboardChange}
        />
      </div>
      <div className="mt-2">
        <Accordion type="single" collapsible>
          <AccordionItem value="advanced" className="border-[var(--line)]">
            <AccordionTrigger className="text-sm text-[var(--ink-soft)] hover:text-[var(--ink)] hover:no-underline py-2">
              {m.upload_advanced_settings()}
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-1">
              <div className="space-y-2">
                <LanguageSelectors
                  summaryLanguage={summaryLanguage}
                  whiteboardLanguage={whiteboardLanguage}
                  showWhiteboardLanguage={showWhiteboardLanguage}
                  onSummaryLanguageChange={onSummaryLanguageChange}
                  onWhiteboardLanguageChange={onWhiteboardLanguageChange}
                />
                {generateWhiteboard && (
                  <p className="text-xs text-[var(--ink-soft)]">
                    {m.upload_english_image_hint()}
                  </p>
                )}
              </div>
              <ApiConfigSelector
                apiSource={apiSource}
                selectedApiConfigId={selectedApiConfigId}
                apiConfigs={apiConfigs}
                onApiSourceChange={onApiSourceChange}
                onApiConfigChange={onApiConfigChange}
              />
              {generateWhiteboard && (
                <PromptSelector
                  selectedPromptId={selectedPromptId}
                  prompts={prompts}
                  onPromptChange={onPromptChange}
                />
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
      {generateWhiteboard && (
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
      )}
    </>
  );
}

export function UploadDialog({ credits, onSuccess }: UploadDialogProps) {
  const fileInputId = useId();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
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
  // dragleave 在拖过子元素时也会触发,不计数遮罩会频闪。
  const dragDepth = useRef(0);
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

  // 文件与链接是「这一次要处理什么」,提交成功或关窗都该清掉;
  // 选项(白板开关 / 语言 / API / 提示词)是偏好,不重置。
  const resetInputs = useCallback(() => {
    setFile(null);
    setFileError(null);
    setLinkUrl("");
  }, []);

  // 文件上传与链接导入的公共尾段：字节进 R2 → 建论文记录。
  // 抛错交给调用方统一 toast，本函数不碰对话框状态。
  // 约定：本文件所有 throw 抛的都是**稳定错误码**（lib/upload-errors.ts），
  // 由 catch 里的 localizeUploadError 统一本地化——中途本地化会让两条路径
  // 一半抛文案一半抛码，混进同一个 catch 后无从分辨。
  const uploadPdfAndCreate = useCallback(
    async (pdf: File) => {
      const resp = await fetch(
        `/api/papers/upload?filename=${encodeURIComponent(pdf.name)}`,
        { method: "POST", body: pdf },
      );
      if (!resp.ok) {
        const err = (await resp.json().catch(() => null)) as {
          error?: string;
        } | null;
        // 拿不到码（网关直接吐了一页 HTML）时给个落 generic 的码占位。
        throw new Error(err?.error ?? UPLOAD_ERROR.BAD_RESPONSE);
      }
      // 200 也可能带非 JSON 体（网关插了一页 HTML）。不兜底的话，原始的
      // "Unexpected token …" SyntaxError 会被调用方的 toast 原样甩给用户。
      const ok = (await resp.json().catch(() => null)) as {
        r2Key: string;
        fileSize: number;
      } | null;
      if (!ok) {
        throw new Error(UPLOAD_ERROR.BAD_RESPONSE);
      }
      const { r2Key, fileSize } = ok;
      await createPaper.mutateAsync({
        sourceType: "upload",
        filename: pdf.name,
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
    },
    [
      createPaper,
      summaryLanguage,
      whiteboardLanguage,
      apiSource,
      selectedApiConfigId,
      selectedPromptId,
      generateWhiteboard,
    ],
  );

  const handleFileUpload = useCallback(async () => {
    if (isReadOnlyGuest) {
      void startGitHubSignIn("/");
      return;
    }
    if (!file) return;
    setUploading(true);
    try {
      await uploadPdfAndCreate(file);
      setOpen(false);
      resetInputs();
      onSuccess?.();
    } catch (e) {
      console.error("Upload failed:", e);
      // 原实现只 console.error，失败时对话框静止不动，用户以为没点上。
      toast.error(localizeUploadError(e));
    } finally {
      setUploading(false);
    }
  }, [file, isReadOnlyGuest, onSuccess, resetInputs, uploadPdfAndCreate]);

  // 通用 PDF 链接：服务端代抓字节（浏览器受 CORS 限制拿不到跨域 PDF），
  // 再走与本地文件完全相同的上传链路。
  const importFromLink = useCallback(
    async (raw: string) => {
      // https + 非私有 host 的前置校验；本地判得掉的错就不必往返一次服务端。
      if (!isAllowedPdfUrl(raw).ok) {
        throw new Error(UPLOAD_ERROR.BAD_URL);
      }
      const resp = await fetch("/api/papers/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: raw }),
      });
      if (!resp.ok) {
        // 非 JSON 响应（网关插了一页 HTML）时给个落 generic 的码占位。
        let code: string = UPLOAD_ERROR.BAD_RESPONSE;
        try {
          const data = (await resp.json()) as { error?: string };
          code = data?.error ?? code;
        } catch {
          // 非 JSON 响应，沿用占位码
        }
        throw new Error(code);
      }
      const blob = await resp.blob();
      const headerName = resp.headers.get("X-Filename");
      const filename = headerName
        ? decodeURIComponent(headerName)
        : "document.pdf";
      await uploadPdfAndCreate(
        new File([blob], filename, { type: "application/pdf" }),
      );
    },
    [uploadPdfAndCreate],
  );

  const handleLinkSubmit = useCallback(async () => {
    if (isReadOnlyGuest) {
      void startGitHubSignIn("/");
      return;
    }
    const raw = linkUrl.trim();
    if (!raw) return;
    setUploading(true);
    try {
      if (isArxivLink(raw)) {
        // canonicalArxivUrl 把裸 id 也补成合法 URL —— paper.create 的 zod
        // 校验是 z.string().url()，直接传 "2601.13209" 会被拒。
        const canonical = canonicalArxivUrl(raw);
        const result = await createPaper.mutateAsync({
          sourceType: "arxiv",
          arxivUrl: canonical,
          filename: canonical.split("/").pop() || "arxiv-paper",
          fileSize: 1, // arXiv 占位值，下载后由服务端更新
          r2Key: `arxiv/${Date.now()}`,
          language: summaryLanguage,
          whiteboardLanguage,
          apiConfigId: apiSource === "user" ? selectedApiConfigId : undefined,
          promptId: generateWhiteboard
            ? (selectedPromptId ?? undefined)
            : undefined,
          generateWhiteboard,
        });
        // 服务端按 canonical source_url 去重了：这一篇早就在库里，什么也没发生。
        // 不说一句的话，对话框一关用户会以为在重新处理。
        if (result.alreadyExists) {
          toast.info(m.assistant_card_added());
        }
      } else {
        await importFromLink(raw);
      }
      setOpen(false);
      resetInputs();
      onSuccess?.();
    } catch (e) {
      console.error("Link import failed:", e);
      toast.error(localizeUploadError(e));
    } finally {
      setUploading(false);
    }
  }, [
    linkUrl,
    createPaper,
    importFromLink,
    isReadOnlyGuest,
    onSuccess,
    resetInputs,
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

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        resetInputs();
        dragDepth.current = 0;
        setDragActive(false);
      }
    },
    [resetInputs],
  );

  // 互斥:两条输入路径同屏,谁被填上就清掉另一条。任何时刻至多一侧有值,
  // 提交时因此不必猜走哪条路,也不用向用户解释「到底会提交哪个」。
  const handleFileSelect = useCallback((selected: File | null) => {
    if (!selected) {
      setFile(null);
      setFileError(null);
      return;
    }
    // 有些系统给 PDF 的 MIME 是空串,只认 type 会把合法文件挡在门外。
    const isPdf =
      selected.type === "application/pdf" ||
      selected.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setFile(null);
      setFileError(m.upload_err_not_pdf());
      return;
    }
    if (selected.size > MAX_FILE_BYTES) {
      setFile(null);
      setFileError(m.upload_err_too_large());
      return;
    }
    setFile(selected);
    setFileError(null);
    setLinkUrl("");
  }, []);

  const handleLinkChange = useCallback((value: string) => {
    setLinkUrl(value);
    if (value.trim()) {
      setFile(null);
      setFileError(null);
    }
  }, []);

  // 整个对话框都收 drop:投递框之外还有选项区和按钮区,在那里松手会被浏览器
  // 接管(直接新开标签打开 PDF),弹窗连同已填的选项一起没了。
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragDepth.current += 1;
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      const droppedFile = e.dataTransfer.files[0];
      // 类型判断交给 handleFileSelect:静默丢弃会让遮罩的「松手以添加」失信。
      if (droppedFile) {
        handleFileSelect(droppedFile);
      }
    },
    [handleFileSelect],
  );

  const openFilePicker = useCallback(() => {
    const input = fileInputRef.current;
    if (!input) return;
    // 清 value:不清的话再选同一个文件不会触发 change,「更换文件」看着像坏了。
    input.value = "";
    input.click();
  }, []);

  const hasLink = linkUrl.trim().length > 0;
  const handleSubmit = useCallback(() => {
    if (file) {
      void handleFileUpload();
      return;
    }
    void handleLinkSubmit();
  }, [file, handleFileUpload, handleLinkSubmit]);

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white">
          <Upload className="mr-2 h-4 w-4" />
          {m.papers_upload()}
        </Button>
      </DialogTrigger>
      <DialogContent
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="sm:max-w-[480px] rounded-3xl border-[var(--line)] bg-[var(--parchment)]"
      >
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {m.papers_upload()}
          </DialogTitle>
        </DialogHeader>
        <div>
          <label
            htmlFor={fileInputId}
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--neutral-mid)] p-6 transition-colors hover:border-[var(--academic-brown)] hover:bg-[var(--academic-brown)]/5"
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
                    // 不预先清空:选择器一取消,原文件就该还在。
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
                <p className="mt-1 text-xs text-[var(--neutral-mid)]">
                  {m.upload_file_size_limit()}
                </p>
              </>
            )}
            {/* 常驻渲染:塞进空态分支的话,「更换文件」点下去时它已经卸载,
                openFilePicker 拿到 null,文件选择器根本不弹。 */}
            <input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
            />
          </label>
          {fileError && (
            <p className="mt-2 text-center text-xs text-[var(--sienna)]">
              {fileError}
            </p>
          )}

          <div className="my-3 flex items-center gap-3">
            <span className="h-px flex-1 bg-[var(--line)]" />
            <span className="text-xs text-[var(--ink-soft)]">
              {m.upload_or()}
            </span>
            <span className="h-px flex-1 bg-[var(--line)]" />
          </div>

          <div className="relative">
            <LinkIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--neutral-mid)]" />
            <Input
              aria-label={m.upload_link_label()}
              placeholder={m.upload_link_placeholder()}
              value={linkUrl}
              onChange={(e) => handleLinkChange(e.target.value)}
              className="border-[var(--line)] pl-9"
            />
          </div>
          <p className="mt-2 text-xs text-[var(--ink-soft)]">
            {m.upload_link_hint()}
          </p>

          <UploadOptions
            generateWhiteboard={generateWhiteboard}
            onGenerateWhiteboardChange={setGenerateWhiteboard}
            credits={credits}
            willCharge={willCharge}
            summaryLanguage={summaryLanguage}
            whiteboardLanguage={whiteboardLanguage}
            showWhiteboardLanguage={generateWhiteboard}
            onSummaryLanguageChange={setSummaryLanguage}
            onWhiteboardLanguageChange={setWhiteboardLanguage}
            apiSource={apiSource}
            selectedApiConfigId={selectedApiConfigId}
            apiConfigs={apiConfigs}
            onApiSourceChange={setApiSource}
            onApiConfigChange={setSelectedApiConfigId}
            selectedPromptId={selectedPromptId}
            prompts={prompts}
            onPromptChange={setSelectedPromptId}
          />
          <Button
            onClick={handleSubmit}
            disabled={
              (!file && !hasLink) ||
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
        </div>

        {dragActive && (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-[var(--academic-brown)] bg-[var(--parchment)]/95">
            <Upload className="h-8 w-8 text-[var(--academic-brown)]" />
            <p className="text-sm font-medium text-[var(--academic-brown)]">
              {m.upload_drop_overlay()}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
