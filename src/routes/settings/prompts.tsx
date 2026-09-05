import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useId, useState } from "react";
import { toast } from "sonner";
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
import { PromptDialog } from "#/components/whiteboard-prompts/prompt-dialog";
import { useEffectiveSession } from "#/hooks/use-effective-session";
import { useTRPC } from "#/integrations/trpc/react";
import { startGitHubSignIn } from "#/lib/auth-client";
import { getSystemDefaultPromptTemplate } from "#/lib/prompt-validation";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/settings/prompts")({
  component: PromptsSettingsPage,
  head: () => ({ meta: [{ title: m.page_title_settings_prompts() }] }),
});

const PREVIEW_CHARS = 120;

/** 模板正文压成单行摘要：行里只给两行 line-clamp 的位置，多余的换行只会浪费它。 */
function preview(template: string) {
  const flat = template.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS
    ? `${flat.slice(0, PREVIEW_CHARS)}…`
    : flat;
}

/** 内置模板是常量，摘要在模块级算一次即可；它也是页面上这份文案的唯一来源。 */
const BUILTIN_PREVIEW = preview(getSystemDefaultPromptTemplate());

/**
 * 白板图模板分区。第一行固定是「内置模板」伪行——它不是数据库里的行，只能查看：
 * 后端没有「无默认」状态（有自定义模板时必有一条 isDefault），所以不给它「设为默认」，
 * 上传时仍可在弹窗里临时选内置。
 */
function PromptsSettingsPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { isReadOnly } = useEffectiveSession();
  const builtinDescriptionId = useId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"edit" | "builtin">("edit");
  const [editingId, setEditingId] = useState<string | undefined>();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const promptsQuery = useQuery(trpc.whiteboardPrompt.list.queryOptions());
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.whiteboardPrompt.list.queryKey(),
    });

  // 两个 mutation 都必须有 onError：AlertDialogAction 是 Radix 的关闭按钮，点下去
  // 弹窗同步关掉，失败时既没有弹窗留住错误、行也原样不动——不弹 toast 的话用户看到
  // 的就是「点了删除，什么都没发生」。同理 setDefault 失败时 chip 不会动。
  const deleteMutation = useMutation({
    ...trpc.whiteboardPrompt.delete.mutationOptions(),
    onSuccess: () => void invalidate(),
    onError: () => toast.error(m.whiteboard_prompt_delete_failed()),
  });
  const setDefaultMutation = useMutation({
    ...trpc.whiteboardPrompt.update.mutationOptions(),
    onSuccess: () => void invalidate(),
    onError: () => toast.error(m.whiteboard_prompt_update_failed()),
  });

  // 审阅访客只读：任何写动作先去登录
  const guarded = (action: () => void) => () => {
    if (isReadOnly) {
      void startGitHubSignIn("/settings/prompts");
      return;
    }
    action();
  };

  // 查看内置模板不写库，只读访客也能看，所以不过 guarded。
  const openBuiltin = () => {
    setDialogMode("builtin");
    setEditingId(undefined);
    setDialogOpen(true);
  };
  const openCreate = guarded(() => {
    setDialogMode("edit");
    setEditingId(undefined);
    setDialogOpen(true);
  });

  const prompts = promptsQuery.data ?? [];
  const deleteTarget = prompts.find((prompt) => prompt.id === deleteId);

  return (
    <>
      <SettingsSection
        title={m.settings_nav_prompts()}
        color="var(--academic-brown)"
        subtitle={m.settings_prompts_subtitle()}
        footer={
          promptsQuery.isSuccess ? (
            <SectionAddButton onClick={openCreate}>
              {m.whiteboard_prompt_create()}
            </SectionAddButton>
          ) : null
        }
      >
        <SettingsRow
          title={m.settings_prompts_builtin()}
          meta={
            <>
              <div className="break-words">
                {m.settings_prompts_builtin_hint()}
              </div>
              <div className="mt-0.5 line-clamp-2 break-words">
                {BUILTIN_PREVIEW}
              </div>
            </>
          }
          actions={
            <>
              <span id={builtinDescriptionId} className="sr-only">
                {m.settings_prompts_builtin()}
              </span>
              <RowAction
                aria-describedby={builtinDescriptionId}
                onClick={openBuiltin}
              >
                {m.settings_prompts_view()}
              </RowAction>
            </>
          }
        />
        {promptsQuery.isPending ? (
          <SettingsListSkeleton />
        ) : promptsQuery.isError ? (
          <SettingsMessageRow className="border-b-0">
            <LoadFailedPanel onRetry={() => void promptsQuery.refetch()} />
          </SettingsMessageRow>
        ) : (
          prompts.map((prompt) => {
            // 每行的动作都叫「设为默认」「编辑」「删除」，读屏里就是一串同名按钮。
            // 用 aria-describedby 指向行内一个 sr-only 的模板名来区分，绝不能用
            // aria-label——它会把按钮后代从可访问性树里剪掉（同 ConfirmButton）。
            const descriptionId = `prompt-${prompt.id}`;
            return (
              <SettingsRow
                key={prompt.id}
                title={<span className="break-words">{prompt.name}</span>}
                badge={prompt.isDefault ? <DefaultChip /> : null}
                meta={
                  <span className="line-clamp-2 break-words">
                    {preview(prompt.promptTemplate)}
                  </span>
                }
                actions={
                  <>
                    {/* sr-only 是 absolute 定位，落在 flex 容器里不占位 */}
                    <span id={descriptionId} className="sr-only">
                      {prompt.name}
                    </span>
                    {!prompt.isDefault ? (
                      <RowAction
                        aria-describedby={descriptionId}
                        onClick={guarded(() =>
                          setDefaultMutation.mutate({
                            id: prompt.id,
                            isDefault: true,
                          }),
                        )}
                        // 只锁在途的那一行：mutation 实例是整页共用的，光看
                        // isPending 会把所有行的按钮一起变灰。
                        disabled={
                          setDefaultMutation.isPending &&
                          setDefaultMutation.variables?.id === prompt.id
                        }
                      >
                        {m.whiteboard_prompt_set_default()}
                      </RowAction>
                    ) : null}
                    <RowAction
                      aria-describedby={descriptionId}
                      onClick={guarded(() => {
                        setDialogMode("edit");
                        setEditingId(prompt.id);
                        setDialogOpen(true);
                      })}
                    >
                      {m.whiteboard_prompt_edit()}
                    </RowAction>
                    <RowAction
                      tone="danger"
                      aria-describedby={descriptionId}
                      onClick={guarded(() => setDeleteId(prompt.id))}
                    >
                      {m.whiteboard_prompt_delete()}
                    </RowAction>
                  </>
                }
              />
            );
          })
        )}
      </SettingsSection>

      <PromptDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingId(undefined);
        }}
        editingPromptId={editingId}
        readOnly={dialogMode === "builtin"}
        onSuccess={() => void invalidate()}
      />

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent className="border-[var(--line)] bg-[var(--parchment)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-xl text-[var(--ink)]">
              {m.whiteboard_prompt_delete()}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--ink-soft)]">
              {deleteTarget?.isDefault
                ? m.whiteboard_prompt_delete_default_confirm({
                    name: deleteTarget.name,
                  })
                : m.whiteboard_prompt_delete_confirm({
                    name: deleteTarget?.name ?? "",
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[var(--line)]">
              {m.cancel()}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteId && deleteMutation.mutate({ id: deleteId })
              }
              className="bg-[var(--sienna)] text-white hover:bg-[var(--sienna)]/90"
            >
              {m.whiteboard_prompt_delete()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
