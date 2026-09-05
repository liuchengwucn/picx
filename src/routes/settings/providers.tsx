import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfigDialog } from "#/components/api-configs/config-dialog";
import {
  DefaultChip,
  RowAction,
  SectionAddButton,
  SettingsListSkeleton,
  SettingsMessageRow,
  SettingsRow,
  SettingsSection,
} from "#/components/settings/settings-primitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { LoadFailedPanel } from "#/components/ui/state-panel";
import { useEffectiveSession } from "#/hooks/use-effective-session";
import { useTRPC } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { startGitHubSignIn } from "#/lib/auth-client";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

export const Route = createFileRoute("/settings/providers")({
  component: ProvidersSettingsPage,
  head: () => ({ meta: [{ title: m.page_title_settings_providers() }] }),
});

/**
 * 从 router 推导而不是手写一份形状：手写的等价物只能靠 `as` 落地，而 `as` 允许
 * 收窄——哪天 schema 上那两列的 enum 约束没了、类型退成 string | null，转换照样
 * 编译通过，只有 TestSummary 里的 === "success" 会静默失效。
 */
type ProviderConfig =
  inferRouterOutputs<TRPCRouter>["apiConfig"]["list"][number];

/** 「✓ 8/30 通过」「✗ 8/30 失败」「未测试」。两组都成功才算通过。 */
function TestSummary({ config }: { config: ProviderConfig }) {
  const tested =
    config.lastTestedAt &&
    config.openaiTestStatus !== "untested" &&
    config.geminiTestStatus !== "untested";
  if (!tested || !config.lastTestedAt) {
    return <span>{m.settings_providers_untested()}</span>;
  }
  const date = new Intl.DateTimeFormat(getLocale(), {
    month: "numeric",
    day: "numeric",
  }).format(config.lastTestedAt);
  const ok =
    config.openaiTestStatus === "success" &&
    config.geminiTestStatus === "success";
  const Icon = ok ? Check : X;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3" strokeWidth={1.25} aria-hidden />
      {ok
        ? m.settings_providers_tested_ok({ date })
        : m.settings_providers_tested_failed({ date })}
    </span>
  );
}

function ProvidersSettingsPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { isReadOnly } = useEffectiveSession();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const configsQuery = useQuery(trpc.apiConfig.list.queryOptions());
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.apiConfig.list.queryKey() });

  // 两个 mutation 都必须有 onError：AlertDialogAction 是 Radix 的关闭按钮，点下去
  // 弹窗同步关掉，失败时既没有弹窗可以留住错误、行也原样不动——不弹 toast 的话
  // 用户看到的就是「点了删除，什么都没发生」，而弹窗里的每个失败都是有提示的。
  const deleteMutation = useMutation({
    ...trpc.apiConfig.delete.mutationOptions(),
    onSuccess: () => void invalidate(),
    onError: () => toast.error(m.api_config_delete_failed()),
  });
  const setDefaultMutation = useMutation({
    ...trpc.apiConfig.update.mutationOptions(),
    onSuccess: () => void invalidate(),
    onError: () => toast.error(m.api_config_update_failed()),
  });

  // 审阅访客只读：任何写动作先去登录
  const guarded = (action: () => void) => () => {
    if (isReadOnly) {
      void startGitHubSignIn("/settings/providers");
      return;
    }
    action();
  };

  const openCreate = guarded(() => {
    setEditingId(undefined);
    setDialogOpen(true);
  });

  const configs = configsQuery.data ?? [];
  const deleteTarget = configs.find((config) => config.id === deleteId);

  return (
    <>
      <SettingsSection
        title={m.settings_nav_providers()}
        color="var(--olive)"
        subtitle={m.settings_providers_subtitle()}
        footer={
          configsQuery.isSuccess ? (
            <SectionAddButton onClick={openCreate}>
              {m.settings_providers_add()}
            </SectionAddButton>
          ) : null
        }
      >
        {configsQuery.isPending ? (
          <SettingsListSkeleton />
        ) : configsQuery.isError ? (
          <SettingsMessageRow className="border-b-0">
            <LoadFailedPanel onRetry={() => void configsQuery.refetch()} />
          </SettingsMessageRow>
        ) : configs.length === 0 ? (
          <SettingsMessageRow className="text-center text-xs text-[var(--ink-soft)]">
            {m.settings_providers_empty()}
          </SettingsMessageRow>
        ) : (
          configs.map((config) => {
            // 每行三个动作都叫「编辑」「删除」，读屏里三行就是六个同名按钮。用
            // aria-describedby 指向行内一个 sr-only 的配置名来区分，绝不能用
            // aria-label——它会把按钮后代从可访问性树里剪掉（同 ConfirmButton）。
            const descriptionId = `provider-${config.id}`;
            return (
              <SettingsRow
                key={config.id}
                title={<span className="break-words">{config.name}</span>}
                badge={config.isDefault ? <DefaultChip /> : null}
                meta={
                  <span className="flex flex-wrap gap-x-1.5 break-words">
                    {/* 分隔点一律是段末的普通文字：做成独立的 flex item 会让换行后
                        的那一行以一个孤零零的「·」开头。 */}
                    <span>
                      {m.settings_providers_openai()} · {config.openaiApiKey} ·{" "}
                      {config.openaiModel} ·
                    </span>
                    <span>
                      {m.settings_providers_gemini()} · {config.geminiApiKey} ·{" "}
                      {config.geminiModel} ·
                    </span>
                    <TestSummary config={config} />
                  </span>
                }
                actions={
                  <>
                    {/* sr-only 是 absolute 定位，落在 flex 容器里不占位 */}
                    <span id={descriptionId} className="sr-only">
                      {config.name}
                    </span>
                    {!config.isDefault ? (
                      <RowAction
                        aria-describedby={descriptionId}
                        onClick={guarded(() =>
                          setDefaultMutation.mutate({
                            id: config.id,
                            isDefault: true,
                          }),
                        )}
                        // 只锁在途的那一行：mutation 实例是整页共用的，光看
                        // isPending 会把所有行的按钮一起变灰。
                        disabled={
                          setDefaultMutation.isPending &&
                          setDefaultMutation.variables?.id === config.id
                        }
                      >
                        {m.api_config_set_default()}
                      </RowAction>
                    ) : null}
                    <RowAction
                      aria-describedby={descriptionId}
                      onClick={guarded(() => {
                        setEditingId(config.id);
                        setDialogOpen(true);
                      })}
                    >
                      {m.edit()}
                    </RowAction>
                    <RowAction
                      tone="danger"
                      aria-describedby={descriptionId}
                      onClick={guarded(() => setDeleteId(config.id))}
                    >
                      {m.api_config_delete()}
                    </RowAction>
                  </>
                }
              />
            );
          })
        )}
      </SettingsSection>

      <ConfigDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingId(undefined);
        }}
        configId={editingId}
        onSuccess={() => void invalidate()}
      />

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent className="border-[var(--line)] bg-[var(--parchment)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-xl text-[var(--ink)]">
              {m.api_config_delete()}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--ink-soft)]">
              {m.api_config_delete_confirm({ name: deleteTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[var(--line)]">
              {m.cancel()}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-[var(--sienna)] text-white hover:bg-[var(--sienna)]/90"
            >
              {m.api_config_delete()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
