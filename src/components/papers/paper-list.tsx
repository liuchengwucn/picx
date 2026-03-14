import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  Clock,
  FileText,
  ImageIcon,
  Loader2,
  XCircle,
} from "lucide-react";
import { Badge } from "#/components/ui/badge";
import { Skeleton } from "#/components/ui/skeleton";
import { m } from "#/paraglide/messages";
import { PublicBadge } from "./public-badge";

type PaperStatus =
  | "pending"
  | "processing_text"
  | "processing_image"
  | "completed"
  | "failed";

interface Paper {
  id: string;
  shortId?: string;
  title: string;
  status: PaperStatus;
  sourceType: string;
  fileSize: number;
  pageCount: number | null;
  createdAt: Date;
  isPublic?: boolean;
}

const statusConfig: Record<
  PaperStatus,
  {
    label: () => string;
    icon: React.ElementType;
    className: string;
    borderColor: string;
  }
> = {
  pending: {
    label: () => m.papers_status_pending(),
    icon: Clock,
    className:
      "bg-[var(--neutral-light)] text-[var(--ink-soft)] border-[var(--neutral-mid)]",
    borderColor: "var(--neutral-mid)",
  },
  processing_text: {
    label: () => m.papers_status_processing_text(),
    icon: Loader2,
    className:
      "bg-[var(--academic-brown)]/10 text-[var(--academic-brown)] border-[var(--academic-brown)]/30",
    borderColor: "var(--academic-brown)",
  },
  processing_image: {
    label: () => m.papers_status_processing_image(),
    icon: ImageIcon,
    className:
      "bg-[var(--gold)]/10 text-[var(--academic-brown-deep)] border-[var(--gold)]/30",
    borderColor: "var(--gold)",
  },
  completed: {
    label: () => m.papers_status_completed(),
    icon: CheckCircle2,
    className:
      "bg-[var(--olive)]/10 text-[var(--olive)] border-[var(--olive)]/30",
    borderColor: "var(--olive)",
  },
  failed: {
    label: () => m.papers_status_failed(),
    icon: XCircle,
    className:
      "bg-[var(--sienna)]/10 text-[var(--sienna)] border-[var(--sienna)]/30",
    borderColor: "var(--sienna)",
  },
};

export function PaperCard({ paper }: { paper: Paper }) {
  const config = statusConfig[paper.status];
  const StatusIcon = config.icon;
  const isProcessing =
    paper.status === "processing_text" || paper.status === "processing_image";

  return (
    <Link
      to={paper.shortId ? "/p/$shortId" : "/papers/$paperId"}
      params={paper.shortId ? { shortId: paper.shortId } : { paperId: paper.id }}
      className="paper-card block p-4 no-underline"
      style={{ borderLeftWidth: "4px", borderLeftColor: config.borderColor }}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--parchment-warm)]">
          <FileText className="h-5 w-5 text-[var(--academic-brown)]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-[var(--ink)]">
            {paper.title}
          </h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--ink-soft)]">
            <span>{new Date(paper.createdAt).toLocaleDateString()}</span>
            {paper.pageCount && <span>· {paper.pageCount} pages</span>}
            <span>· {(paper.fileSize / 1024 / 1024).toFixed(1)} MB</span>
          </div>
          <div className="mt-2 flex items-center gap-2 sm:hidden">
            {paper.isPublic && <PublicBadge />}
            <Badge variant="outline" className={`gap-1 ${config.className}`}>
              <StatusIcon
                className={`h-3 w-3 ${isProcessing ? "animate-spin" : ""}`}
              />
              {config.label()}
            </Badge>
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          {paper.isPublic && <PublicBadge />}
          <Badge variant="outline" className={`gap-1 ${config.className}`}>
            <StatusIcon
              className={`h-3 w-3 ${isProcessing ? "animate-spin" : ""}`}
            />
            {config.label()}
          </Badge>
        </div>
      </div>
    </Link>
  );
}

export function PaperCardSkeleton() {
  return (
    <div
      className="paper-card p-4"
      style={{
        borderLeftWidth: "4px",
        borderLeftColor: "var(--neutral-light)",
      }}
    >
      <div className="flex items-start gap-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--parchment-warm)]">
        <FileText className="h-10 w-10 text-[var(--neutral-mid)]" />
      </div>
      <h3 className="mt-4 font-serif text-lg font-semibold text-[var(--ink)]">
        {m.papers_empty_title()}
      </h3>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        {m.papers_empty_description()}
      </p>
    </div>
  );
}
