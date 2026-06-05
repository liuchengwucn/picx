import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ConvertProgress,
  type ProgressPhase,
} from "#/components/reader/convert-progress";
import { ReaderView } from "#/components/reader/reader-view";
import { AnalyzingCard, TrimReview } from "#/components/reader/trim-review";
import { UploadZone } from "#/components/reader/upload-zone";
import { useRequireAuth } from "#/hooks/use-require-auth";
import { useTRPC } from "#/integrations/trpc/react";
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
  | "analyzing"
  | "confirm"
  | "uploading"
  | "processing"
  | "rendering"
  | "reading"
  | "error";

function ReaderPage() {
  const trpc = useTRPC();
  const { session, isSessionPending } = useRequireAuth("/reader");

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
    } else if (resultQuery.error) {
      setErrorMessage(resultQuery.error.message);
      setPhase("error");
    }
  }, [phase, resultQuery.data, resultQuery.error]);

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

  async function startConversion(f: File) {
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

  function reset() {
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
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
    } else {
      reset();
    }
  }

  if (isSessionPending) {
    return <ReaderAuthLoading />;
  }
  if (!session) {
    return <ReaderAuthLoading redirecting />;
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
        <UploadZone onFile={startConversion} />
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
    phase === "uploading" || phase === "processing" || phase === "rendering"
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

function ReaderAuthLoading({ redirecting }: { redirecting?: boolean }) {
  return (
    <main className="page-wrap flex min-h-[60vh] items-center justify-center py-12">
      <div className="text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-[var(--academic-brown)]" />
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          {redirecting ? m.reader_auth_redirect() : m.reader_auth_loading()}
        </p>
      </div>
    </main>
  );
}
