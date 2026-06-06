import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ConvertProgress,
  type ProgressPhase,
} from "#/components/reader/convert-progress";
import {
  hashBytes,
  type ReaderHistoryEntry,
  type ReaderHistorySource,
  useReaderHistory,
} from "#/components/reader/reader-history";
import { ReaderView } from "#/components/reader/reader-view";
import { RecentReads } from "#/components/reader/recent-reads";
import { AnalyzingCard, TrimReview } from "#/components/reader/trim-review";
import { UploadZone } from "#/components/reader/upload-zone";
import { useTRPC } from "#/integrations/trpc/react";
import { authClient, startGitHubSignIn } from "#/lib/auth-client";
import type { TrimPlan } from "#/lib/pdf-trim";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/reader/")({
  component: ReaderPage,
  head: () => ({
    meta: [{ title: m.reader_page_title() }],
  }),
});

type Phase =
  | "idle"
  | "fetching"
  | "analyzing"
  | "confirm"
  | "uploading"
  | "processing"
  | "rendering"
  | "reading"
  | "error";

function ReaderPage() {
  const trpc = useTRPC();
  const { data: session } = authClient.useSession();

  const userId = session?.user?.id ?? null;
  const { entries, record, remove } = useReaderHistory(userId);
  const pendingMetaRef = useRef<{
    id: string;
    source: ReaderHistorySource;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [doc, setDoc] = useState<{ title: string; markdown: string } | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [trimPlan, setTrimPlan] = useState<TrimPlan | null>(null);
  const [trimBusy, setTrimBusy] = useState(false);

  const pdfUrlRef = useRef<string | null>(null);
  const lastUrlRef = useRef<string | null>(null);

  const statusQuery = useQuery({
    ...trpc.reader.getStatus.queryOptions({ batchId: batchId ?? "" }),
    enabled: !!batchId && phase === "processing",
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "done" || state === "failed" ? false : 3000;
    },
    refetchOnWindowFocus: false,
  });

  const resultQuery = useQuery({
    ...trpc.reader.getResult.queryOptions({ batchId: batchId ?? "" }),
    enabled: !!batchId && phase === "rendering",
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  // 轮询状态 → 阶段流转
  useEffect(() => {
    if (phase !== "processing") {
      return;
    }
    const state = statusQuery.data?.state;
    if (state === "failed") {
      setErrorMessage(statusQuery.data?.errMsg || m.reader_error_parse());
      setPhase("error");
    } else if (state === "done") {
      setPhase("rendering");
    }
  }, [phase, statusQuery.data]);

  useEffect(() => {
    if (phase === "processing" && statusQuery.error) {
      setErrorMessage(statusQuery.error.message);
      setPhase("error");
    }
  }, [phase, statusQuery.error]);

  // 结果就绪 → 阅读
  useEffect(() => {
    if (phase !== "rendering") {
      return;
    }
    if (resultQuery.data) {
      setDoc(resultQuery.data);
      setPhase("reading");
      const meta = pendingMetaRef.current;
      if (meta && userId) {
        void record({
          id: meta.id,
          userId,
          title: resultQuery.data.title,
          markdown: resultQuery.data.markdown,
          source: meta.source,
          now: Date.now(),
        });
      }
    } else if (resultQuery.error) {
      setErrorMessage(resultQuery.error.message);
      setPhase("error");
    }
  }, [phase, resultQuery.data, resultQuery.error, record, userId]);

  // 卸载时释放对象 URL
  useEffect(() => {
    return () => {
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
      }
    };
  }, []);

  // 把字节发给服务端中转(浏览器无法直传 OSS，详见 /api/reader/upload)。File 与裁剪后的
  // Uint8Array 都可直接作为 body。
  async function runUpload(body: BodyInit, filename: string) {
    setPhase("uploading");
    const resp = await fetch(
      `/api/reader/upload?filename=${encodeURIComponent(filename)}`,
      { method: "POST", body },
    );
    if (!resp.ok) {
      let message: string = m.reader_error_upload();
      try {
        const data = (await resp.json()) as { error?: string };
        if (data?.error) {
          message = data.error;
        }
      } catch {
        // 非 JSON 响应,沿用默认文案
      }
      throw new Error(message);
    }
    const { batchId: id } = (await resp.json()) as { batchId: string };
    setBatchId(id);
    setPhase("processing");
  }

  function failWith(err: unknown) {
    setErrorMessage(
      err instanceof Error ? err.message : m.reader_error_upload(),
    );
    setPhase("error");
  }

  async function startConversion(
    f: File,
    sourceOverride?: ReaderHistorySource,
  ) {
    // 阅读器页面对所有人可见,但真正上传前才要求登录。
    if (!session) {
      void startGitHubSignIn("/reader");
      return;
    }
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
    }
    const url = URL.createObjectURL(f);
    pdfUrlRef.current = url;

    setFile(f);
    setPdfUrl(url);
    setDoc(null);
    setBatchId(null);
    setErrorMessage(null);
    setTrimPlan(null);
    setPhase("analyzing");

    try {
      const buf = await f.arrayBuffer();
      try {
        pendingMetaRef.current = {
          id: await hashBytes(buf),
          source: sourceOverride ?? { kind: "upload", name: f.name },
        };
      } catch {
        pendingMetaRef.current = null; // 指纹失败不阻断阅读,只是不记历史
      }
      let plan: TrimPlan | null = null;
      try {
        const { analyzePdfForTrim } = await import("#/lib/pdf-trim");
        plan = await analyzePdfForTrim(buf);
      } catch (err) {
        // 分析失败不阻断:直接上传完整版。
        console.warn("PDF trim analysis failed; uploading full file.", err);
      }
      if (plan && plan.droppedPages > 0) {
        setTrimPlan(plan);
        setPhase("confirm");
        return;
      }
      await runUpload(f, f.name);
    } catch (err) {
      failWith(err);
    }
  }

  async function startFromUrl(rawUrl: string) {
    // Reader is public, but importing requires login (same gate as upload).
    if (!session) {
      void startGitHubSignIn("/reader");
      return;
    }
    lastUrlRef.current = rawUrl;
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
    setFile(null);
    setPdfUrl(null);
    setDoc(null);
    setBatchId(null);
    setErrorMessage(null);
    setTrimPlan(null);
    setPhase("fetching");

    try {
      const resp = await fetch("/api/reader/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: rawUrl }),
      });
      if (!resp.ok) {
        let message: string = m.reader_error_upload();
        try {
          const data = (await resp.json()) as { error?: string };
          if (data?.error) {
            message = data.error;
          }
        } catch {
          // non-JSON response; keep default
        }
        throw new Error(message);
      }
      const blob = await resp.blob();
      const headerName = resp.headers.get("X-Filename");
      const filename = headerName
        ? decodeURIComponent(headerName)
        : "document.pdf";
      const file = new File([blob], filename, { type: "application/pdf" });
      // Hand off to the existing local-upload path (analyze → trim → upload).
      await startConversion(file, {
        kind: "url",
        name: file.name,
        url: rawUrl,
      });
    } catch (err) {
      failWith(err);
    }
  }

  async function confirmTrim() {
    if (!file || !trimPlan) {
      return;
    }
    setTrimBusy(true);
    try {
      const buf = await file.arrayBuffer();
      let body: BodyInit = file;
      try {
        const { trimPdfToPages } = await import("#/lib/pdf-trim");
        const trimmed = await trimPdfToPages(buf, trimPlan.keptPages);
        // new Uint8Array(...) 确保是 ArrayBuffer 背衬(满足 BlobPart 类型)。
        body = new Blob([new Uint8Array(trimmed)], { type: "application/pdf" });
      } catch (err) {
        // 裁剪失败兜底为完整版。
        console.warn("PDF trim failed; uploading full file.", err);
        body = file;
      }
      await runUpload(body, file.name);
    } catch (err) {
      failWith(err);
    } finally {
      setTrimBusy(false);
    }
  }

  async function uploadFull() {
    if (!file) {
      return;
    }
    setTrimBusy(true);
    try {
      await runUpload(file, file.name);
    } catch (err) {
      failWith(err);
    } finally {
      setTrimBusy(false);
    }
  }

  function openFromHistory(entry: ReaderHistoryEntry) {
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
    lastUrlRef.current = null;
    setFile(null);
    setPdfUrl(null);
    setBatchId(null);
    setErrorMessage(null);
    setTrimPlan(null);
    setTrimBusy(false);
    setDoc({ title: entry.title, markdown: entry.markdown });
    setPhase("reading");
    // 刷新 lastReadAt(置顶);失败静默。
    if (userId) {
      void record({
        id: entry.id,
        userId,
        title: entry.title,
        markdown: entry.markdown,
        source: entry.source,
        now: Date.now(),
      });
    }
  }

  function reset() {
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
    lastUrlRef.current = null;
    pendingMetaRef.current = null;
    setFile(null);
    setPdfUrl(null);
    setBatchId(null);
    setDoc(null);
    setErrorMessage(null);
    setTrimPlan(null);
    setTrimBusy(false);
    setPhase("idle");
  }

  function retry() {
    if (file) {
      void startConversion(file);
    } else if (lastUrlRef.current) {
      void startFromUrl(lastUrlRef.current);
    } else {
      reset();
    }
  }

  if (phase === "reading" && doc) {
    return (
      <main>
        <ReaderView
          title={doc.title}
          markdown={doc.markdown}
          pdfUrl={pdfUrl}
          onNew={reset}
        />
      </main>
    );
  }

  if (phase === "idle") {
    return (
      <main>
        <UploadZone onFile={startConversion} onUrl={startFromUrl} />
        <RecentReads
          entries={entries}
          onOpen={openFromHistory}
          onRemove={(id) => void remove(id)}
        />
      </main>
    );
  }

  if (phase === "analyzing") {
    return (
      <main>
        <AnalyzingCard fileName={file?.name ?? null} />
      </main>
    );
  }

  if (phase === "confirm" && trimPlan) {
    return (
      <main>
        <TrimReview
          fileName={file?.name ?? null}
          plan={trimPlan}
          busy={trimBusy}
          onConfirmTrim={confirmTrim}
          onUploadFull={uploadFull}
          onCancel={reset}
        />
      </main>
    );
  }

  const progressPhase: ProgressPhase =
    phase === "fetching" ||
    phase === "uploading" ||
    phase === "processing" ||
    phase === "rendering"
      ? phase
      : "error";
  return (
    <main>
      <ConvertProgress
        phase={progressPhase}
        fileName={file?.name ?? null}
        errorMessage={errorMessage}
        onRetry={retry}
        onReset={reset}
      />
    </main>
  );
}
