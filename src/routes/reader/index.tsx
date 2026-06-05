import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ConvertProgress,
  type ProgressPhase,
} from "#/components/reader/convert-progress";
import { ReaderView } from "#/components/reader/reader-view";
import { UploadZone } from "#/components/reader/upload-zone";
import { useRequireAuth } from "#/hooks/use-require-auth";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/reader/")({
  component: ReaderPage,
  head: () => ({
    meta: [{ title: m.reader_page_title() }],
  }),
});

type Phase =
  | "idle"
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
    setPhase("uploading");

    try {
      // 把 PDF 字节发给服务端中转(浏览器无法直传 OSS，详见 /api/reader/upload)。
      const resp = await fetch(
        `/api/reader/upload?filename=${encodeURIComponent(f.name)}`,
        { method: "POST", body: f },
      );
      if (!resp.ok) {
        let message: string = m.reader_error_upload();
        try {
          const body = (await resp.json()) as { error?: string };
          if (body?.error) {
            message = body.error;
          }
        } catch {
          // 非 JSON 响应,沿用默认文案
        }
        throw new Error(message);
      }
      const { batchId: id } = (await resp.json()) as { batchId: string };
      setBatchId(id);
      setPhase("processing");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : m.reader_error_upload(),
      );
      setPhase("error");
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
