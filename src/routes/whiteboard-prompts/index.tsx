import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Clock, Edit3, FileText, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Skeleton } from "#/components/ui/skeleton";
import { PromptDialog } from "#/components/whiteboard-prompts/prompt-dialog";
import { useRequireAuth } from "#/hooks/use-require-auth";
import { useTRPC } from "#/integrations/trpc/react";
import { authClient } from "#/lib/auth-client";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";
import { m } from "#/paraglide/messages";
import styles from "./styles.module.css";

export const Route = createFileRoute("/whiteboard-prompts/")({
  component: WhiteboardPromptsPage,
});

type WhiteboardPrompt = {
  id: string;
  name: string;
  promptTemplate: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function WhiteboardPromptsPage() {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<string | null>(null);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<string | undefined>();
  const trpc = useTRPC();

  const { session, isSessionPending } = useRequireAuth("/whiteboard-prompts");

  const promptsQuery = useQuery(trpc.whiteboardPrompt.list.queryOptions());

  const deleteMutation = useMutation({
    ...trpc.whiteboardPrompt.delete.mutationOptions(),
    onSuccess: () => {
      promptsQuery.refetch();
      setDeleteDialogOpen(false);
      setPromptToDelete(null);
    },
  });

  const setDefaultMutation = useMutation({
    ...trpc.whiteboardPrompt.update.mutationOptions(),
    onSuccess: () => {
      promptsQuery.refetch();
    },
  });

  const handleDelete = (id: string) => {
    setPromptToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (promptToDelete) {
      deleteMutation.mutate({ id: promptToDelete });
    }
  };

  const handleSetDefault = (id: string) => {
    setDefaultMutation.mutate({ id, isDefault: true });
  };

  const handleCreate = () => {
    if (isReadOnly) {
      void authClient.signIn.social({
        provider: "github",
        callbackURL: "/whiteboard-prompts",
      });
      return;
    }
    setEditingPromptId(undefined);
    setPromptDialogOpen(true);
  };

  const handleEdit = (id: string) => {
    if (isReadOnly) {
      void authClient.signIn.social({
        provider: "github",
        callbackURL: "/whiteboard-prompts",
      });
      return;
    }
    setEditingPromptId(id);
    setPromptDialogOpen(true);
  };

  const handleDialogClose = () => {
    setPromptDialogOpen(false);
    setEditingPromptId(undefined);
    promptsQuery.refetch();
  };

  // Show loading while checking session
  if (isSessionPending) {
    return (
      <main className="page-wrap py-8">
        <div className="stagger-in">
          <div className="h-8 w-32 bg-neutral-100 dark:bg-neutral-800 animate-pulse mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!session) {
    return null;
  }

  const isReadOnly = isReviewGuestReadOnlySession(session);
  const prompts = promptsQuery.data || [];
  const promptToDeleteData = prompts.find((p) => p.id === promptToDelete);

  return (
    <main className="page-wrap py-8">
      <div className="stagger-in">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            <h1 className="font-serif text-2xl font-bold text-[var(--ink)] mb-1">
              {m.whiteboard_prompt_page_title()}
            </h1>
            <p className="text-sm text-[var(--ink-soft)]">
              {m.whiteboard_prompt_page_description()}
            </p>
          </div>
          <Button
            onClick={handleCreate}
            className={`${styles.createButton} bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white`}
          >
            <Plus className="mr-2 h-4 w-4" />
            {m.whiteboard_prompt_create()}
          </Button>
        </div>

        {/* Empty State */}
        {prompts.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <FileText className="h-16 w-16 text-[var(--academic-brown)] opacity-40" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--ink)] mb-2">
              {m.whiteboard_prompt_empty_state()}
            </h3>
            <p className="text-sm text-[var(--ink-soft)] mb-6 max-w-md">
              {m.whiteboard_prompt_empty_hint()}
            </p>
            <Button
              onClick={handleCreate}
              className="bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white"
            >
              <Plus className="mr-2 h-4 w-4" />
              {m.whiteboard_prompt_create()}
            </Button>
          </div>
        ) : (
          /* Prompt Cards Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
            {prompts.map((prompt, index) => (
              <div
                key={prompt.id}
                className={`${styles.promptCard} ${prompt.isDefault ? styles.defaultCard : ""}`}
                style={{
                  animationDelay: `${index * 50}ms`,
                }}
              >
                {/* Card Header */}
                <div className={styles.cardHeader}>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className={styles.cardTitle}>{prompt.name}</h3>
                    {prompt.isDefault && (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-[var(--gold)]/20 to-[var(--academic-brown)]/20 border border-[var(--gold)]/30">
                        <Star className="h-3 w-3 text-[var(--gold)] fill-[var(--gold)]" />
                        <span className="text-xs font-semibold text-[var(--academic-brown-deep)]">
                          {m.whiteboard_prompt_default_badge()}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)]">
                    <Clock className="h-3 w-3" />
                    <span>
                      {new Date(prompt.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Prompt Preview */}
                <div className={styles.promptPreview}>
                  <div className={styles.previewContent}>
                    {prompt.promptTemplate.substring(0, 180)}
                    {prompt.promptTemplate.length > 180 && "..."}
                  </div>
                </div>

                {/* Card Actions */}
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    onClick={() => handleEdit(prompt.id)}
                    className={styles.actionButton}
                    title={m.whiteboard_prompt_edit()}
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  {!prompt.isDefault && (
                    <button
                      type="button"
                      onClick={() => handleSetDefault(prompt.id)}
                      className={styles.actionButton}
                      title={m.whiteboard_prompt_set_default()}
                    >
                      <Star className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(prompt.id)}
                    className={`${styles.actionButton} ${styles.deleteButton}`}
                    title={m.whiteboard_prompt_delete()}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Dialog */}
        <PromptDialog
          open={promptDialogOpen}
          onOpenChange={handleDialogClose}
          editingPromptId={editingPromptId}
        />

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent className="sm:max-w-[425px] rounded-2xl border-[var(--line)] bg-[var(--parchment)]">
            <DialogHeader>
              <DialogTitle className="font-serif text-xl">
                {m.whiteboard_prompt_delete()}
              </DialogTitle>
              <DialogDescription className="text-[var(--ink-soft)]">
                {promptToDeleteData?.isDefault
                  ? m.whiteboard_prompt_delete_default_confirm()
                  : m.whiteboard_prompt_delete_confirm()}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button
                variant="ghost"
                onClick={() => setDeleteDialogOpen(false)}
                className="text-[var(--ink-soft)]"
              >
                {m.cancel?.() || "Cancel"}
              </Button>
              <Button
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
                className="bg-[var(--sienna)] hover:bg-[var(--sienna)]/90 text-white"
              >
                {m.whiteboard_prompt_delete()}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}
