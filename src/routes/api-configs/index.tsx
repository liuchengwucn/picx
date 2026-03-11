import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Cpu,
  Edit3,
  Globe,
  Key,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { ConfigDialog } from "#/components/api-configs/config-dialog";
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
import { useRequireAuth } from "#/hooks/use-require-auth";
import { useTRPC } from "#/integrations/trpc/react";
import { authClient } from "#/lib/auth-client";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";
import { m } from "#/paraglide/messages";
import styles from "./styles.module.css";

export const Route = createFileRoute("/api-configs/")({
  component: ApiConfigsPage,
  head: () => ({
    meta: [
      {
        title: m.page_title_api_configs(),
      },
    ],
  }}),
}});

const configSkeletonKeys = [
  "config-skeleton-1",
  "config-skeleton-2",
  "config-skeleton-3",
];

type ApiConfig = {
  id: string;
  name: string;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  geminiApiKey: string;
  geminiBaseUrl: string;
  geminiModel: string;
  isDefault: boolean;
  openaiTestStatus: "success" | "failed" | null;
  geminiTestStatus: "success" | "failed" | null;
  lastTestedAt: Date | null;
  createdAt: Date;
};

function ApiConfigsPage() {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<string | null>(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [editingConfigId, setEditingConfigId] = useState<string | undefined>();
  const trpc = useTRPC();

  const { session, isSessionPending } = useRequireAuth("/api-configs");

  const configsQuery = useQuery(trpc.apiConfig.list.queryOptions());

  const deleteMutation = useMutation({
    ...trpc.apiConfig.delete.mutationOptions(),
    onSuccess: () => {
      configsQuery.refetch();
      setDeleteDialogOpen(false);
      setConfigToDelete(null);
    },
  });

  const setDefaultMutation = useMutation({
    ...trpc.apiConfig.update.mutationOptions(),
    onSuccess: () => {
      configsQuery.refetch();
    },
  });

  const handleDelete = (id: string) => {
    setConfigToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (configToDelete) {
      deleteMutation.mutate(configToDelete);
    }
  };

  const handleCreate = () => {
    if (isReadOnly) {
      void authClient.signIn.social({
        provider: "github",
        callbackURL: "/api-configs",
      });
      return;
    }
    setEditingConfigId(undefined);
    setConfigDialogOpen(true);
  };

  const handleEdit = (id: string) => {
    if (isReadOnly) {
      void authClient.signIn.social({
        provider: "github",
        callbackURL: "/api-configs",
      });
      return;
    }
    setEditingConfigId(id);
    setConfigDialogOpen(true);
  };

  const handleDialogSuccess = () => {
    configsQuery.refetch();
  };

  const handleSetDefault = (id: string) => {
    setDefaultMutation.mutate({ id, isDefault: true });
  };

  // Show loading while checking session
  if (isSessionPending) {
    return (
      <main className="page-wrap py-8">
        <div className="stagger-in">
          <div className="h-8 w-32 bg-neutral-100 dark:bg-neutral-800 animate-pulse mb-6" />
          <div className="space-y-4">
            {configSkeletonKeys.map((skeletonKey) => (
              <ConfigCardSkeleton key={skeletonKey} />
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

  return (
    <main className="page-wrap py-8">
      <div className="stagger-in">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            <h1 className="font-serif text-2xl font-bold text-[var(--ink)] mb-1">
              {m.api_configs_title()}
            </h1>
            <p className="text-sm text-[var(--ink-soft)]">
              {m.api_configs_description()}
            </p>
          </div>
          <Button
            onClick={handleCreate}
            className={`${styles.createButton} bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white`}
          >
            <Plus className="mr-2 h-4 w-4" />
            {m.api_config_create()}
          </Button>
        </div>

        {/* Config List */}
        <div className="mt-6 space-y-4">
          {configsQuery.isLoading ? (
            configSkeletonKeys.map((skeletonKey) => (
              <ConfigCardSkeleton key={skeletonKey} />
            ))
          ) : configsQuery.data?.length === 0 ? (
            <EmptyState />
          ) : (
            configsQuery.data?.map((config) => (
              <ConfigCard
                key={config.id}
                config={config}
                onDelete={handleDelete}
                onEdit={handleEdit}
                onSetDefault={handleSetDefault}
              />
            ))
          )}
        </div>

        {/* Config Dialog */}
        <ConfigDialog
          open={configDialogOpen}
          onOpenChange={setConfigDialogOpen}
          configId={editingConfigId}
          onSuccess={handleDialogSuccess}
        />

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{m.api_config_delete()}</DialogTitle>
              <DialogDescription>
                {m.api_config_delete_confirm()}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteDialogOpen(false)}
                disabled={deleteMutation.isPending}
              >
                {m.api_config_cancel()}
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <>
                    <Clock className="h-4 w-4 animate-spin" />
                    {m.api_config_deleting()}
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    {m.api_config_delete()}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}

function ConfigCard({
  config,
  onDelete,
  onEdit,
  onSetDefault,
}: {
  config: ApiConfig;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  onSetDefault: (id: string) => void;
}) {
  const getStatusIcon = (status: "success" | "failed" | null) => {
    if (status === "success") {
      return (
        <CheckCircle2
          className={`h-4 w-4 text-[var(--olive)] ${styles.statusIndicator}`}
        />
      );
    }
    if (status === "failed") {
      return (
        <AlertCircle
          className={`h-4 w-4 text-[var(--sienna)] ${styles.statusIndicator}`}
        />
      );
    }
    return (
      <Clock
        className={`h-4 w-4 text-[var(--neutral-mid)] ${styles.statusIndicator}`}
      />
    );
  };

  return (
    <div
      className={`paper-card p-6 relative overflow-hidden ${styles.configCard} ${config.isDefault ? styles.defaultCard : ""}`}
    >
      {/* Decorative corner accent */}
      {config.isDefault && (
        <div className="absolute top-0 right-0 w-24 h-24 opacity-10">
          <div className="absolute top-0 right-0 w-full h-full bg-gradient-to-br from-[var(--gold)] to-transparent rotate-45 translate-x-12 -translate-y-12" />
        </div>
      )}

      <div className="relative">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-serif text-lg font-bold text-[var(--ink)]">
                  {config.name}
                </h3>
                {config.isDefault && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-[var(--gold)]/20 to-[var(--academic-brown)]/20 border border-[var(--gold)]/30">
                    <Star className="h-3 w-3 text-[var(--gold)] fill-[var(--gold)]" />
                    <span className="text-xs font-semibold text-[var(--academic-brown-deep)]">
                      {m.api_config_default()}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)] mt-0.5">
                <Clock className="h-3 w-3" />
                <span>{new Date(config.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onEdit(config.id)}
              className={styles.actionButton}
              title={m.api_config_edit()}
            >
              <Edit3 className="h-4 w-4" />
            </button>
            {!config.isDefault && (
              <button
                type="button"
                onClick={() => onSetDefault(config.id)}
                className={styles.actionButton}
                title={m.api_config_set_default()}
              >
                <Star className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(config.id)}
              className={`${styles.actionButton} ${styles.deleteButton}`}
              title={m.api_config_delete()}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Config Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* OpenAI Config */}
          <div className="space-y-2 p-4 rounded-lg bg-[var(--parchment-warm)]/50 border border-[var(--line)]">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-[var(--academic-brown)]/10">
                <Cpu className="h-3.5 w-3.5 text-[var(--academic-brown)]" />
              </div>
              <span className="text-xs font-semibold text-[var(--ink)] uppercase tracking-wide">
                OpenAI
              </span>
              {getStatusIcon(config.openaiTestStatus)}
            </div>
            <ConfigField
              icon={<Key className="h-3 w-3" />}
              label={m.label_api_key()}
              value={config.openaiApiKey}
              mono
            />
            <ConfigField
              icon={<Globe className="h-3 w-3" />}
              label={m.label_base_url()}
              value={config.openaiBaseUrl}
              mono
            />
            <ConfigField
              icon={<Cpu className="h-3 w-3" />}
              label={m.label_model()}
              value={config.openaiModel}
              mono
            />
          </div>

          {/* Gemini Config */}
          <div className="space-y-2 p-4 rounded-lg bg-[var(--parchment-warm)]/50 border border-[var(--line)]">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-[var(--gold)]/10">
                <Cpu className="h-3.5 w-3.5 text-[var(--academic-brown-deep)]" />
              </div>
              <span className="text-xs font-semibold text-[var(--ink)] uppercase tracking-wide">
                Gemini
              </span>
              {getStatusIcon(config.geminiTestStatus)}
            </div>
            <ConfigField
              icon={<Key className="h-3 w-3" />}
              label={m.label_api_key()}
              value={config.geminiApiKey}
              mono
            />
            <ConfigField
              icon={<Globe className="h-3 w-3" />}
              label={m.label_base_url()}
              value={config.geminiBaseUrl}
              mono
            />
            <ConfigField
              icon={<Cpu className="h-3 w-3" />}
              label={m.label_model()}
              value={config.geminiModel}
              mono
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigField({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex items-center justify-center w-5 h-5 mt-0.5 text-[var(--ink-soft)]">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[var(--ink-soft)] mb-0.5">{label}</p>
        <p
          className={`text-sm text-[var(--ink)] truncate ${
            mono ? "font-mono" : ""
          }`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

function ConfigCardSkeleton() {
  return (
    <div className="paper-card p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-40 rounded-lg" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>
        <Key className="h-16 w-16 text-[var(--academic-brown)] opacity-40" />
      </div>
      <h3 className="text-lg font-semibold text-[var(--ink)] mb-2">
        {m.api_config_empty_title()}
      </h3>
      <p className="text-sm text-[var(--ink-soft)] mb-6 max-w-md">
        {m.api_config_empty_description()}
      </p>
    </div>
  );
}
