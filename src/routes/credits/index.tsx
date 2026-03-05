import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	ArrowDownRight,
	ArrowUpRight,
	ChevronLeft,
	ChevronRight,
	Coins,
	Gift,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { useTRPC } from "#/integrations/trpc/react";
import { authClient } from "#/lib/auth-client";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/credits/")({
	component: CreditsPage,
});

const typeIcons: Record<string, React.ElementType> = {
	initial: Gift,
	consume: ArrowDownRight,
	refund: ArrowUpRight,
	purchase: ArrowUpRight,
};

const typeLabels: Record<string, () => string> = {
	initial: () => m.credits_type_initial(),
	consume: () => m.credits_type_consume(),
	refund: () => m.credits_type_refund(),
	purchase: () => m.credits_type_purchase(),
};

function CreditsPage() {
	const [page, setPage] = useState(1);
	const trpc = useTRPC();
	const navigate = useNavigate();

	const { data: session, isPending: isSessionPending } =
		authClient.useSession();

	const profile = useQuery(trpc.user.getProfile.queryOptions());
	const history = useQuery(
		trpc.user.getCreditHistory.queryOptions({ page, limit: 20 }),
	);

	const totalPages = Math.ceil((history.data?.total ?? 0) / 20);

	// Redirect to home if not authenticated
	useEffect(() => {
		if (!isSessionPending && !session) {
			navigate({ to: "/", search: { redirect: "/credits" } });
		}
	}, [session, isSessionPending, navigate]);

	// Show loading while checking session
	if (isSessionPending) {
		return (
			<main className="page-wrap py-8">
				<div className="stagger-in">
					<div className="h-8 w-32 bg-neutral-100 dark:bg-neutral-800 animate-pulse mb-6" />
					<div className="paper-card p-6">
						<Skeleton className="h-14 w-full" />
					</div>
				</div>
			</main>
		);
	}

	// Don't render if not authenticated (will redirect)
	if (!session) {
		return null;
	}

	return (
		<main className="page-wrap py-8">
			<div className="stagger-in">
				<h1 className="font-serif text-2xl font-bold text-[var(--ink)]">
					{m.credits_title()}
				</h1>

				{/* Balance card */}
				<div className="paper-card mt-6 flex items-center gap-4 p-6">
					<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--academic-brown)] to-[var(--gold)]">
						<Coins className="h-7 w-7 text-white" />
					</div>
					<div>
						<p className="text-sm text-[var(--ink-soft)]">
							{m.credits_balance()}
						</p>
						<p className="font-serif text-3xl font-bold text-[var(--ink)]">
							{profile.isLoading ? (
								<Skeleton className="h-9 w-20" />
							) : (
								(profile.data?.credits ?? 0)
							)}
						</p>
					</div>
				</div>

				{/* Transaction history */}
				<div className="paper-card mt-6 overflow-hidden">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{m.credits_col_time()}</TableHead>
								<TableHead>{m.credits_col_type()}</TableHead>
								<TableHead className="text-right">
									{m.credits_col_amount()}
								</TableHead>
								<TableHead>{m.credits_col_description()}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{history.isLoading ? (
								Array.from({ length: 5 }).map((_, i) => (
									<TableRow key={i}>
										<TableCell>
											<Skeleton className="h-4 w-24" />
										</TableCell>
										<TableCell>
											<Skeleton className="h-4 w-16" />
										</TableCell>
										<TableCell>
											<Skeleton className="h-4 w-12 ml-auto" />
										</TableCell>
										<TableCell>
											<Skeleton className="h-4 w-32" />
										</TableCell>
									</TableRow>
								))
							) : history.data?.transactions.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={4}
										className="py-12 text-center text-[var(--ink-soft)]"
									>
										{m.credits_empty()}
									</TableCell>
								</TableRow>
							) : (
								history.data?.transactions.map((tx) => {
									const Icon = typeIcons[tx.type] ?? Coins;
									const isPositive = tx.amount > 0;
									return (
										<TableRow key={tx.id}>
											<TableCell className="text-sm text-[var(--ink-soft)]">
												{new Date(tx.createdAt).toLocaleString()}
											</TableCell>
											<TableCell>
												<span className="inline-flex items-center gap-1 text-sm">
													<Icon className="h-3.5 w-3.5" />
													{typeLabels[tx.type]?.() ?? tx.type}
												</span>
											</TableCell>
											<TableCell
												className={`text-right font-mono text-sm font-semibold ${isPositive ? "text-[var(--olive)]" : "text-[var(--sienna)]"}`}
											>
												{isPositive ? "+" : ""}
												{tx.amount}
											</TableCell>
											<TableCell className="text-sm text-[var(--ink-soft)]">
												{tx.description}
											</TableCell>
										</TableRow>
									);
								})
							)}
						</TableBody>
					</Table>
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
