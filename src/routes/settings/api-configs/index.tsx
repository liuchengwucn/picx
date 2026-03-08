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
  Zap,
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
import { m } from "#/paraglide/messages";
import styles from "./styles.module.css";

export const Route = createFileRoute("/settings/api-configs/")({
  component: ApiConfigsPage,
});

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

  const { session, isSessionPending } = useRequireAuth("/settings/api-configs");

  const configsQuery = useQuery(trpc.apiConfig.list.queryOptions());

  const deleteMutation = useMutation({
    ...trpc.apiConfig.delete.mutationOptions(),
    onSuccess: () => {
      configsQuery.refetch();
      setDeleteDialogOpen(false);
      setConfigToDelete(null);
    },
  });

  const testMutation = useMutation({
    ...trpc.apiConfig.test.mutationOptions(),
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

  const handleTest = (id: string) => {
    testMutation.mutate({ id });
  };

  const handleCreate = () => {
    setEditingConfigId(undefined);
    setConfigDialogOpen(true);
  };

  const handleEdit = (id: string) => {
    setEditingConfigId(id);
    setConfigDialogOpen(true);
  };

  const handleDialogSuccess = () => {
    configsQuery.refetch();
  };

  // Show loading while checking session
  if (isSessionPending) {
    return (
      <main className="page-wrap py-8">
        <div className="stagger-in">
          <div className="h-8 w-32 bg-neutral-100 dark:bg-neutral-800 animate-pulse mb-6" />
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <ConfigCardSkeleton key={i} />
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
            size="sm"
            onClick={handleCreate}
            className="shrink-0 gap-2 bg-gradient-to-r from-[var(--academic-brown)] to-[var(--gold)] hover:from-[var(--academic-brown-deep)] hover:to-[var(--academic-brown)] transition-all duration-300"
          >
            <Plus className="h-4 w-4" />
            {m.api_config_create()}
          </Button>
        </div>

        {/* Config List */}
        <div className="mt-6 space-y-4">
          {configsQuery.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <ConfigCardSkeleton key={i} />
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
                onTest={handleTest}
                isTesting={testMutation.isPending}
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
                    Deleting...
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
  onTest,
  isTesting,
}: {
  config: ApiConfig;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  onTest: (id: string) => void;
  isTesting: boolean;
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
      style={{
        background: config.isDefault
          ? "linear-gradient(135deg, rgba(139,111,71,0.08) 0%, var(--surface) 100%)"
          : undefined,
      }}
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
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--academic-brown)] to-[var(--gold)] shadow-lg">
              <Key className="h-6 w-6 text-white" />
            </div>
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
              <p className="text-xs text-[var(--ink-soft)] mt-0.5">
                Created {new Date(config.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onTest(config.id)}
              disabled={isTesting}
              className={`hover:bg-[var(--academic-brown)]/10 ${styles.actionButton}`}
            >
              <Zap className="h-4 w-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onEdit(config.id)}
              className={`hover:bg-[var(--academic-brown)]/10 ${styles.actionButton}`}
            >
              <Edit3 className="h-4 w-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onDelete(config.id)}
              className={`hover:bg-[var(--sienna)]/10 hover:text-[var(--sienna)] ${styles.actionButton}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
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
              label="API Key"
              value={config.openaiApiKey}
              mono
            />
            <ConfigField
              icon={<Globe className="h-3 w-3" />}
              label="Base URL"
              value={config.openaiBaseUrl}
              mono
            />
            <ConfigField
              icon={<Cpu className="h-3 w-3" />}
              label="Model"
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
              label="API Key"
              value={config.geminiApiKey}
              mono
            />
            <ConfigField
              icon={<Globe className="h-3 w-3" />}
              label="Base URL"
              value={config.geminiBaseUrl}
              mono
            />
            <ConfigField
              icon={<Cpu className="h-3 w-3" />}
              label="Model"
              value={config.geminiModel}
              mono
            />
          </div>
        </div>

        {/* Last Tested */}
        {config.lastTestedAt && (
          <div className="mt-4 pt-4 border-t border-[var(--line)]">
            <p className="text-xs text-[var(--ink-soft)]">
              Last tested: {new Date(config.lastTestedAt).toLocaleString()}
            </p>
          </div>
        )}
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
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--academic-brown)]/10 to-[var(--gold)]/10 border-2 border-dashed border-[var(--neutral-mid)]">
        <Key className="h-10 w-10 text-[var(--neutral-mid)]" />
      </div>
      <h3 className="mt-4 font-serif text-lg font-semibold text-[var(--ink)]">
        No API Configurations
      </h3>
      <p className="mt-1 text-sm text-[var(--ink-soft)] max-w-sm">
        Create your first API configuration to start using custom OpenAI and
        Gemini endpoints.
      </p>
    </div>
  );
}
