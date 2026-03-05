import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import {
	EmptyState,
	PaperCard,
	PaperCardSkeleton,
} from "#/components/papers/paper-list";
import { UploadDialog } from "#/components/papers/upload-dialog";
import { Button } from "#/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { usePaperSSE } from "#/hooks/use-paper-sse";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";

type StatusFilter =
	| "all"
	| "pending"
	| "processing_text"
	| "processing_image"
	| "completed"
	| "failed";

export const Route = createFileRoute("/papers/")({
	component: PapersPage,
});

function PapersPage() {
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [page, setPage] = useState(1);
	const trpc = useTRPC();

	const profile = useQuery(trpc.user.getProfile.queryOptions());
	usePaperSSE(profile.data?.id);

	const papersQuery = useQuery(
		trpc.paper.list.queryOptions({
			page,
			limit: 20,
			status: statusFilter === "all" ? undefined : statusFilter,
		}),
	);

	const totalPages = Math.ceil((papersQuery.data?.total ?? 0) / 20);

	return (
		<main className="page-wrap py-8">
			<div className="stagger-in">
				{/* Header */}
				<div className="flex items-center justify-between">
					<h1 className="font-serif text-2xl font-bold text-[var(--ink)]">
						{m.papers_title()}
					</h1>
					<UploadDialog
						credits={profile.data?.credits ?? 0}
						onSuccess={() => papersQuery.refetch()}
					/>
				</div>

				{/* Status filter tabs */}
				<Tabs
					value={statusFilter}
					onValueChange={(v) => {
						setStatusFilter(v as StatusFilter);
						setPage(1);
					}}
					className="mt-6"
				>
					<TabsList>
						<TabsTrigger value="all">{m.papers_filter_all()}</TabsTrigger>
						<TabsTrigger value="processing_text">
							{m.papers_filter_processing()}
						</TabsTrigger>
						<TabsTrigger value="completed">
							{m.papers_filter_completed()}
						</TabsTrigger>
						<TabsTrigger value="failed">{m.papers_filter_failed()}</TabsTrigger>
					</TabsList>
				</Tabs>

				{/* Paper list */}
				<div className="mt-6 space-y-3">
					{papersQuery.isLoading ? (
						Array.from({ length: 5 }).map((_, i) => (
							<PaperCardSkeleton key={i} />
						))
					) : papersQuery.data?.papers.length === 0 ? (
						<EmptyState />
					) : (
						papersQuery.data?.papers.map((paper) => (
							<PaperCard key={paper.id} paper={paper} />
						))
					)}
				</div>

				{/* Pagination */}
				{totalPages > 1 && (
					<div className="mt-6 flex items-center justify-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => setPage((p) => Math.max(1, p - 1))}
							disabled={page === 1}
						>
							<ChevronLeft className="h-4 w-4" />
						</Button>
						<span className="text-sm text-[var(--ink-soft)]">
							{page} / {totalPages}
						</span>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
							disabled={page === totalPages}
						>
							<ChevronRight className="h-4 w-4" />
						</Button>
					</div>
				)}
			</div>
		</main>
	);
}
