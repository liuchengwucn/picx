import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileText,
  ImageIcon,
  Languages,
  Loader2,
  Network,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
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
import { useRequireAuth } from "#/hooks/use-require-auth";
import { useTRPC } from "#/integrations/trpc/react";
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

  const { session, isSessionPending } = useRequireAuth("/papers");

  const profile = useQuery(trpc.user.getProfile.queryOptions());
  usePaperSSE(profile.data?.id);

  const { data, isLoading } = useQuery(
    trpc.paper.getById.queryOptions(paperId),
  );

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
  if (!session) return null;
  if (isLoading) return <DetailSkeleton />;
  if (!data) return null;

  const { paper, result } = data;
  const progress = statusProgress[paper.status] ?? 0;

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

        {/* Two-column layout */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
          {/* Left: Paper info */}
          <div className="space-y-4">
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

              {/* Status + Progress */}
              <div className="mt-4">
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
              </div>

              {/* Meta info */}
              <div className="mt-4 space-y-2 border-t border-[var(--line)] pt-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--ink-soft)]">
                    {m.paper_source()}
                  </span>
                  <span>
                    {paper.sourceType === "arxiv"
                      ? "arXiv"
                      : m.paper_source_upload()}
                  </span>
                </div>
                {paper.pageCount && (
                  <div className="flex justify-between">
                    <span className="text-[var(--ink-soft)]">
                      {m.paper_pages()}
                    </span>
                    <span>{paper.pageCount}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[var(--ink-soft)]">
                    {m.paper_size()}
                  </span>
                  <span>{(paper.fileSize / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 flex gap-2 border-t border-[var(--line)] pt-4">
                {result?.whiteboardImageR2Key && (
                  <Button variant="outline" size="sm" asChild>
                    <a href="#whiteboard">
                      <Network className="mr-1.5 h-4 w-4" />
                      {m.paper_whiteboard()}
                    </a>
                  </Button>
                )}
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
              </div>
            </div>
          </div>

          {/* Right: Results */}
          <div className="space-y-4">
            {result ? (
              <>
                <Accordion type="single" collapsible defaultValue="summary">
                  <AccordionItem value="summary" className="paper-card px-6">
                    <div className="flex items-center justify-between py-4">
                      <AccordionTrigger className="font-serif text-lg font-semibold flex-1 py-0 hover:no-underline">
                        <span className="hover:underline">
                          {m.paper_summary()}
                        </span>
                      </AccordionTrigger>
                      <div className="flex items-center gap-2 ml-4">
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
                        <Select
                          value={result.summaryLanguage || "en"}
                          onValueChange={(
                            value: "en" | "zh-cn" | "zh-tw" | "ja",
                          ) => {
                            regenerateSummaryMutation.mutate({
                              paperId,
                              language: value,
                            });
                          }}
                          disabled={regenerateSummaryMutation.isPending}
                        >
                          <SelectTrigger className="w-[140px] h-9">
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
                              <code
                                className={`${className || ""} break-words`}
                              >
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

                {result.whiteboardImageR2Key && (
                  <div id="whiteboard" className="paper-card p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="font-serif text-lg font-semibold text-[var(--ink)]">
                        {m.paper_whiteboard()}
                      </h2>
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={`/api/r2/${result.whiteboardImageR2Key}`}
                          download={`${paper.title}-whiteboard.png`}
                          className="gap-1.5"
                        >
                          <Download className="h-4 w-4" />
                          {m.paper_whiteboard_download()}
                        </a>
                      </Button>
                    </div>
                    <div className="overflow-hidden rounded-lg">
                      <img
                        src={`/api/r2/${result.whiteboardImageR2Key}`}
                        alt="Whiteboard"
                        className="w-full h-auto cursor-zoom-in"
                      />
                    </div>
                  </div>
                )}
              </>
            ) : paper.status !== "failed" ? (
              <div className="paper-card flex flex-col items-center justify-center p-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--academic-brown)]" />
                <p className="mt-4 text-sm text-[var(--ink-soft)]">
                  {m.paper_processing_hint()}
                </p>
              </div>
            ) : null}
          </div>
        </div>
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
      className: "bg-[var(--olive)]/10 text-[var(--olive)]",
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
