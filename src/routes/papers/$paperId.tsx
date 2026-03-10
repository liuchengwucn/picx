import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileText,
  ImageIcon,
  Languages,
  Loader2,
  Maximize2,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { paperCompletedBadgeToneClassName } from "#/components/papers/paper-badge-styles";
import { PublicBadge } from "#/components/papers/public-badge";
import { RegenerateWhiteboardDialog } from "#/components/papers/regenerate-whiteboard-dialog";
import { ShareBanner } from "#/components/papers/share-banner";
import { WhiteboardGalleryDialog } from "#/components/papers/whiteboard-gallery-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "#/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "#/components/ui/dialog";
import { Progress } from "#/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Skeleton } from "#/components/ui/skeleton";
import { usePaperSSE } from "#/hooks/use-paper-sse";
import { useTRPC } from "#/integrations/trpc/react";
import {
  authClient,
  startGitHubSignIn as beginGitHubSignIn,
} from "#/lib/auth-client";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/papers/$paperId")({
  component: PaperDetailPage,
});

/**
 * Normalize AI-generated math markdown before handing it to remark-math.
 *
 * Models sometimes emit display equations as a single indented line:
 * `$$ ... $$`
 * remark-math parses that as inline math, which makes KaTeX reject commands
 * like `\tag{}` that only work in display mode. Rewriting those standalone lines
 * into a multi-line display block keeps existing summaries renderable.
 */
function normalizeMathMarkdown(markdown: string): string {
  return markdown
    .replace(
      /(^[ \t]*)\$\$\s*([^\n]+?)\s*\$\$(?=[ \t]*$)/gm,
      (_match, indent, content) => {
        return `${indent}$$\n${indent}${content}\n${indent}$$`;
      },
    )
    .replace(/\\text\{([^}]*\\_[^}]*)\}/g, (_match, content) => {
      return `\\mathrm{${content}}`;
    });
}

const statusProgress: Record<string, number> = {
  pending: 10,
  processing_text: 40,
  processing_image: 70,
  completed: 100,
  failed: 0,
};

function PaperDetailPage() {
  const { paperId } = Route.useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [isWhiteboardPreviewOpen, setIsWhiteboardPreviewOpen] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(true);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isRegenerateOpen, setIsRegenerateOpen] = useState(false);

  // Use optional auth - allow viewing public papers without login
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const isReadOnlyGuest = isReviewGuestReadOnlySession(session);

  const startGitHubSignIn = useCallback(() => {
    void beginGitHubSignIn("/");
  }, []);

  const profile = useQuery({
    ...trpc.user.getProfile.queryOptions(),
    enabled: !!session,
  });
  usePaperSSE(profile.data?.id);

  const { data, isLoading, error } = useQuery(
    trpc.paper.getById.queryOptions(paperId),
  );

  const { data: whiteboardsData } = useQuery({
    ...trpc.paper.listWhiteboards.queryOptions(paperId),
    enabled: !!data?.paper && data.paper.status === "completed",
  });

  const deleteMutation = useMutation(
    trpc.paper.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.paper.list.queryKey() });
        navigate({ to: "/papers" });
      },
    }),
  );

  const regenerateSummaryMutation = useMutation(
    trpc.paper.regenerateSummary.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.paper.getById.queryKey(paperId),
        });
      },
    }),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(min-width: 1024px)");

    const syncViewport = (matches: boolean) => {
      setIsDesktopViewport(matches);
      if (!matches) {
        setIsWhiteboardPreviewOpen(false);
      }
    };

    syncViewport(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      syncViewport(event.matches);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const handleCopyMarkdown = async () => {
    if (!result?.summary) return;
    try {
      await navigator.clipboard.writeText(result.summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Show loading while checking session
  if (isSessionPending) return <DetailSkeleton />;
  if (isLoading) return <DetailSkeleton />;

  // Handle errors
  if (error) {
    const isForbidden =
      error.message?.includes("permission") ||
      error.message?.includes("FORBIDDEN");
    const isNotFound =
      error.message?.includes("not found") ||
      error.message?.includes("NOT_FOUND");

    return <PaperErrorPage isNotFound={isNotFound} isForbidden={isForbidden} />;
  }

  if (!data) return null;

  const { paper, result, defaultWhiteboard } = data;
  const progress = statusProgress[paper.status] ?? 0;
  const whiteboardImageUrl = defaultWhiteboard?.imageR2Key
    ? `/api/r2/${defaultWhiteboard.imageR2Key}`
    : null;

  return (
    <main className="page-wrap py-8">
      <div className="stagger-in">
        {/* Breadcrumb */}
        <nav className="flex items-start gap-1 text-sm text-[var(--ink-soft)]">
          <Link to="/papers" className="hover:text-[var(--ink)] shrink-0">
            {m.papers_title()}
          </Link>
          <ChevronRight className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="text-[var(--ink)] break-words min-w-0">
            {paper.title}
          </span>
        </nav>

        {/* Share Banner - only show to owner */}
        {paper.userId === profile.data?.id && (
          <ShareBanner
            paperId={paper.id}
            isPublic={paper.isPublic}
            isListedInGallery={paper.isListedInGallery}
            canShare={
              paper.status === "completed" &&
              !!defaultWhiteboard?.imageR2Key
            }
          />
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
          <aside className="space-y-4 lg:sticky lg:top-24">
            <div className="paper-card p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--parchment-warm)]">
                  <FileText className="h-6 w-6 text-[var(--academic-brown)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="font-serif text-lg font-bold text-[var(--ink)] break-words">
                    {paper.title}
                  </h1>
                  <p className="text-xs text-[var(--ink-soft)]">
                    {new Date(paper.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--ink-soft)]">
                    {m.paper_status()}
                  </span>
                  <StatusBadge status={paper.status} />
                </div>
                {paper.status !== "failed" && (
                  <Progress value={progress} className="mt-2 h-2" />
                )}
                {paper.errorMessage && (
                  <p className="mt-2 text-xs text-[var(--sienna)]">
                    {paper.errorMessage}
                  </p>
                )}
                {paper.isPublic && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--ink-soft)]">
                      {m.paper_visibility()}
                    </span>
                    <PublicBadge />
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2 border-t border-[var(--line)] pt-4 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--ink-soft)]">
                    {m.paper_source()}
                  </span>
                  <span className="text-right">
                    {paper.sourceType === "arxiv" && paper.sourceUrl ? (
                      <a
                        href={paper.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--academic-brown)] hover:underline"
                      >
                        arXiv
                      </a>
                    ) : paper.sourceType === "arxiv" ? (
                      "arXiv"
                    ) : (
                      m.paper_source_upload()
                    )}
                  </span>
                </div>
                {paper.pageCount && (
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--ink-soft)]">
                      {m.paper_pages()}
                    </span>
                    <span className="text-right">{paper.pageCount}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--ink-soft)]">
                    {m.paper_size()}
                  </span>
                  <span className="text-right">
                    {(paper.fileSize / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>
              </div>

              <div className="mt-4 flex gap-2 border-t border-[var(--line)] pt-4">
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={`/api/r2/${paper.pdfR2Key}`}
                    download={`${paper.title}.pdf`}
                  >
                    <Download className="mr-1.5 h-4 w-4" />
                    {m.paper_download_pdf()}
                  </a>
                </Button>
                {/* Only show delete button to paper owner */}
                {paper.userId === profile.data?.id &&
                  (isReadOnlyGuest ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-[var(--sienna)]"
                      onClick={startGitHubSignIn}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      {m.paper_delete()}
                    </Button>
                  ) : (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-[var(--sienna)]"
                        >
                          <Trash2 className="mr-1.5 h-4 w-4" />
                          {m.paper_delete()}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {m.paper_delete_confirm_title()}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {m.paper_delete_confirm_description()}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{m.cancel()}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteMutation.mutate(paperId)}
                            className="bg-[var(--sienna)] hover:bg-[var(--sienna)]/90"
                          >
                            {m.paper_delete()}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ))}
              </div>
            </div>

            {whiteboardImageUrl && (
              <div className="paper-card p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-lg font-semibold text-[var(--ink)]">
                      {m.paper_whiteboard()}
                    </h2>
                  </div>
                  <div className="flex gap-2">
                    {paper.userId === profile.data?.id &&
                      whiteboardsData &&
                      whiteboardsData.whiteboards.length > 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsGalleryOpen(true)}
                          className="gap-1.5"
                        >
                          <ImageIcon className="h-4 w-4" />
                          {m.paper_whiteboard_view_all()}
                        </Button>
                      )}
                    {paper.userId === profile.data?.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsRegenerateOpen(true)}
                        className="gap-1.5"
                      >
                        <Sparkles className="h-4 w-4" />
                        {m.paper_whiteboard_regenerate()}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={whiteboardImageUrl}
                        download={`${paper.title}-whiteboard.png`}
                        className="gap-1.5"
                      >
                        <Download className="h-4 w-4" />
                        {m.paper_whiteboard_download()}
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--line)] bg-[var(--parchment-warm)] p-3 lg:hidden">
                  <div className="overflow-hidden rounded-xl bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(245,237,223,0.95))]">
                    <img
                      src={whiteboardImageUrl}
                      alt={`${paper.title} ${m.paper_whiteboard()}`}
                      className="mx-auto h-auto max-h-[420px] w-full object-contain"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (isDesktopViewport) {
                      setIsWhiteboardPreviewOpen(true);
                    }
                  }}
                  className="group hidden w-full rounded-2xl border border-[var(--line)] bg-[var(--parchment-warm)] p-3 text-left transition hover:border-[var(--academic-brown)]/30 hover:shadow-[0_18px_50px_rgba(87,61,38,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/35 lg:block"
                  aria-label={m.paper_whiteboard()}
                >
                  <div className="relative overflow-hidden rounded-xl bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(245,237,223,0.95))]">
                    <img
                      src={whiteboardImageUrl}
                      alt={`${paper.title} ${m.paper_whiteboard()}`}
                      className="mx-auto h-auto max-h-[360px] w-full object-contain transition duration-300 group-hover:scale-[1.015]"
                    />
                    <div className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full border border-white/80 bg-white/88 px-3 py-1.5 text-xs font-medium text-[var(--ink)] shadow-sm backdrop-blur-sm">
                      <Maximize2 className="h-3.5 w-3.5" />
                      <span>{m.paper_whiteboard()}</span>
                    </div>
                  </div>
                </button>
              </div>
            )}
          </aside>

          <section className="space-y-4 min-w-0">
            {result ? (
              <Accordion type="single" collapsible defaultValue="summary">
                <AccordionItem value="summary" className="paper-card px-6">
                  <div className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <AccordionTrigger className="font-serif text-lg font-semibold flex-1 py-0 hover:no-underline">
                      <span className="hover:underline">
                        {m.paper_summary()}
                      </span>
                    </AccordionTrigger>
                    <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyMarkdown}
                        className="gap-1.5"
                      >
                        {copied ? (
                          <>
                            <CheckCircle2 className="h-4 w-4" />
                            {m.paper_summary_copied()}
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4" />
                            {m.paper_summary_copy()}
                          </>
                        )}
                      </Button>
                      {/* Only show language selector to paper owner */}
                      {paper.userId === profile.data?.id && (
                        <Select
                          value={result.summaryLanguage || "en"}
                          onValueChange={(
                            value: "en" | "zh-cn" | "zh-tw" | "ja",
                          ) => {
                            if (isReadOnlyGuest) {
                              startGitHubSignIn();
                              return;
                            }
                            regenerateSummaryMutation.mutate({
                              paperId,
                              language: value,
                            });
                          }}
                          disabled={regenerateSummaryMutation.isPending}
                        >
                          <SelectTrigger className="h-9 w-auto min-w-0 max-w-full">
                            <div className="flex items-center gap-1.5 w-full">
                              {regenerateSummaryMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                              ) : (
                                <Languages className="h-4 w-4 shrink-0" />
                              )}
                              <SelectValue />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="en">
                              {m.upload_language_en()}
                            </SelectItem>
                            <SelectItem value="zh-cn">
                              {m.upload_language_zh()}
                            </SelectItem>
                            <SelectItem value="zh-tw">
                              {m.upload_language_zh_tw()}
                            </SelectItem>
                            <SelectItem value="ja">
                              {m.upload_language_ja()}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                  <AccordionContent>
                    <div className="prose prose-sm max-w-none text-[var(--ink)] break-words overflow-hidden">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex, rehypeHighlight]}
                        components={{
                          pre: ({ children }) => (
                            <pre className="overflow-x-auto max-w-full">
                              {children}
                            </pre>
                          ),
                          code: ({ children, className }) => (
                            <code className={`${className || ""} break-words`}>
                              {children}
                            </code>
                          ),
                          table: ({ children }) => (
                            <div className="overflow-x-auto">
                              <table>{children}</table>
                            </div>
                          ),
                        }}
                      >
                        {normalizeMathMarkdown(result.summary)}
                      </ReactMarkdown>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : paper.status !== "failed" ? (
              <div className="paper-card flex flex-col items-center justify-center p-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--academic-brown)]" />
                <p className="mt-4 text-sm text-[var(--ink-soft)]">
                  {m.paper_processing_hint()}
                </p>
              </div>
            ) : null}
          </section>
        </div>

        {whiteboardImageUrl && (
          <Dialog
            open={isDesktopViewport && isWhiteboardPreviewOpen}
            onOpenChange={(open) => {
              setIsWhiteboardPreviewOpen(open && isDesktopViewport);
            }}
          >
            <DialogContent className="max-h-[96vh] max-w-[min(98vw,1440px)] rounded-[28px] border-[var(--line)] bg-[var(--parchment)] p-2 shadow-[0_30px_120px_rgba(39,29,21,0.35)] sm:max-w-[min(98vw,1440px)] sm:p-5">
              <DialogTitle className="sr-only">
                {paper.title} {m.paper_whiteboard()}
              </DialogTitle>

              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-4 pr-10">
                  <div className="min-w-0">
                    <h2 className="font-serif text-xl font-semibold text-[var(--ink)] break-words">
                      {m.paper_whiteboard()}
                    </h2>
                    <p className="mt-1 text-sm text-[var(--ink-soft)] break-words">
                      {paper.title}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={whiteboardImageUrl}
                      download={`${paper.title}-whiteboard.png`}
                      className="gap-1.5"
                    >
                      <Download className="h-4 w-4" />
                      {m.paper_whiteboard_download()}
                    </a>
                  </Button>
                </div>

                <div className="overflow-auto rounded-[22px] border border-[var(--line)] bg-[var(--parchment-warm)]/80 p-2 sm:p-4">
                  <img
                    src={whiteboardImageUrl}
                    alt={`${paper.title} ${m.paper_whiteboard()}`}
                    className="mx-auto h-auto max-h-[calc(96vh-8rem)] w-full object-contain rounded-[18px]"
                  />
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Gallery Dialog */}
        {whiteboardsData && (
          <WhiteboardGalleryDialog
            paperId={paperId}
            whiteboards={whiteboardsData.whiteboards}
            open={isGalleryOpen}
            onOpenChange={setIsGalleryOpen}
          />
        )}

        {/* Regenerate Dialog */}
        <RegenerateWhiteboardDialog
          paperId={paperId}
          open={isRegenerateOpen}
          onOpenChange={setIsRegenerateOpen}
        />
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<
    string,
    { label: () => string; icon: React.ElementType; className: string }
  > = {
    pending: {
      label: () => m.papers_status_pending(),
      icon: Clock,
      className: "bg-[var(--neutral-light)] text-[var(--ink-soft)]",
    },
    processing_text: {
      label: () => m.papers_status_processing_text(),
      icon: Loader2,
      className: "bg-[var(--academic-brown)]/10 text-[var(--academic-brown)]",
    },
    processing_image: {
      label: () => m.papers_status_processing_image(),
      icon: ImageIcon,
      className: "bg-[var(--gold)]/10 text-[var(--academic-brown-deep)]",
    },
    completed: {
      label: () => m.papers_status_completed(),
      icon: CheckCircle2,
      className: paperCompletedBadgeToneClassName,
    },
    failed: {
      label: () => m.papers_status_failed(),
      icon: XCircle,
      className: "bg-[var(--sienna)]/10 text-[var(--sienna)]",
    },
  };
  const c = configs[status] ?? configs.pending;
  const Icon = c.icon;
  const isSpinning = status.startsWith("processing");
  return (
    <Badge variant="outline" className={`gap-1 ${c.className}`}>
      <Icon className={`h-3 w-3 ${isSpinning ? "animate-spin" : ""}`} />
      {c.label()}
    </Badge>
  );
}

function DetailSkeleton() {
  return (
    <main className="page-wrap py-8">
      <Skeleton className="h-4 w-48" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-60 rounded-xl" />
      </div>
    </main>
  );
}

function PaperErrorPage({
  isNotFound,
  isForbidden,
}: {
  isNotFound: boolean;
  isForbidden: boolean;
}) {
  const title = isNotFound
    ? m.paper_not_found_title()
    : isForbidden
      ? m.paper_not_public_title()
      : m.paper_not_found_title();

  const description = isNotFound
    ? m.paper_not_found_description()
    : isForbidden
      ? m.paper_not_public_description()
      : m.paper_not_found_description();

  return (
    <main className="page-wrap py-8">
      <div className="rise-in mx-auto max-w-md py-16 text-center">
        <div className="mb-6 flex justify-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-[var(--sienna)]/10 shadow-[0_8px_24px_rgba(139,111,71,0.12)]">
            <AlertCircle className="h-12 w-12 text-[var(--sienna)]" />
          </div>
        </div>
        <h2 className="mb-3 font-serif text-2xl font-bold text-[var(--ink)]">
          {title}
        </h2>
        <p className="mb-6 text-base text-[var(--ink-soft)]">{description}</p>
        <Link
          to="/papers"
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--academic-brown)] px-6 py-3 text-sm font-semibold !text-white shadow-[0_4px_12px_rgba(139,111,71,0.24)] transition-all hover:-translate-y-1 hover:shadow-[0_6px_16px_rgba(139,111,71,0.32)] no-underline"
        >
          <FileText className="h-4 w-4" />
          {m.paper_error_back()}
        </Link>
      </div>
    </main>
  );
}
