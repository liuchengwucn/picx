import { useMutation } from "@tanstack/react-query";
import { FileText, Link as LinkIcon, Loader2, Upload } from "lucide-react";
import { useCallback, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { useTRPC } from "#/integrations/trpc/react";
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

export function UploadDialog({ credits, onSuccess }: UploadDialogProps) {
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
  const trpc = useTRPC();

  const uploadFile = useMutation(trpc.upload.uploadFile.mutationOptions());
  const createPaper = useMutation(trpc.paper.create.mutationOptions());

  const handleFileUpload = useCallback(async () => {
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
      });
      setOpen(false);
      setFile(null);
      onSuccess?.();
    } catch (e) {
      console.error("Upload failed:", e);
    } finally {
      setUploading(false);
    }
  }, [file, uploadFile, createPaper, onSuccess]);

  const handleArxivSubmit = useCallback(async () => {
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
      });
      setOpen(false);
      setArxivUrl("");
      onSuccess?.();
    } catch (e) {
      console.error("arXiv submit failed:", e);
    } finally {
      setUploading(false);
    }
  }, [arxivUrl, createPaper, onSuccess]);

  const insufficientCredits = credits < 1;

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type === "application/pdf") {
      setFile(droppedFile);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            <div
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
                    onClick={() => setFile(null)}
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
                  <label className="mt-2 cursor-pointer text-sm font-medium text-[var(--academic-brown)] hover:underline">
                    {m.upload_select_file()}
                    <input
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  <p className="mt-1 text-xs text-[var(--neutral-mid)]">
                    PDF, max 50MB
                  </p>
                </>
              )}
            </div>
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
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-[var(--ink-soft)]">
                {m.credits_balance()}: {credits}
              </span>
              <span className="text-[var(--ink-soft)]">
                {m.upload_cost()}: 1
              </span>
            </div>
            <Button
              onClick={handleFileUpload}
              disabled={!file || uploading || insufficientCredits}
              className="mt-3 w-full bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white"
            >
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {m.upload_start()}
            </Button>
            {insufficientCredits && (
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
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-[var(--ink-soft)]">
                {m.credits_balance()}: {credits}
              </span>
              <span className="text-[var(--ink-soft)]">
                {m.upload_cost()}: 1
              </span>
            </div>
            <Button
              onClick={handleArxivSubmit}
              disabled={!arxivUrl || uploading || insufficientCredits}
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
