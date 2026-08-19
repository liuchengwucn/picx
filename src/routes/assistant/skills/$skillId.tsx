import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Loader2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SkillDocumentEditor } from "#/components/assistant/skill-document-editor";
import { resolveSkillErrorMessage } from "#/components/assistant/skill-error";
import { Button } from "#/components/ui/button";
import { Switch } from "#/components/ui/switch";
import { useRequireAuth } from "#/hooks/use-require-auth";
import { useTRPC } from "#/integrations/trpc/react";
// 走 names 这个叶子模块而不是 #/lib/builtin-skills：后者 ?raw 引入三份 SKILL.md，
// import 它会把约 7KB 正文打进这个路由 chunk，而这里只要名字和前缀判断
import { BUILTIN_SKILL_NAMES, isBuiltinId } from "#/lib/builtin-skills/names";
import { formatSkillMarkdown, type SkillInput } from "#/lib/skills";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

export const Route = createFileRoute("/assistant/skills/$skillId")({
  component: AssistantSkillEditPage,
  head: () => ({
    meta: [{ title: m.assistant_skills_title() }],
  }),
});

function AssistantSkillEditPage() {
  const { skillId } = Route.useParams();
  const { session, isSessionPending } = useRequireAuth("/assistant/skills");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const getQuery = useQuery({
    ...trpc.skills.get.queryOptions({ id: skillId }),
    enabled: !!session,
  });

  const invalidateList = () =>
    void queryClient.invalidateQueries({
      queryKey: trpc.skills.list.queryKey(),
    });

  const updateMutation = useMutation(
    trpc.skills.update.mutationOptions({
      onSuccess: (result, variables) => {
        invalidateList();
        void queryClient.invalidateQueries({
          queryKey: trpc.skills.get.queryKey({ id: variables.id }),
        });
        // 列表 enabled 开关也走 update：只有编辑器保存（带 body）才弹「已保存」
        if (variables.body != null) toast.success(m.assistant_skills_saved());
        // 内置行被写就实体化成一条真实行，URL 里的 builtin: 前缀必须换成真 id，
        // 否则后续保存会反复实体化，而这一页的 get 还指着虚拟 id
        if (result.id !== variables.id) {
          // 新 id 的 query key 是全新的、这条路由没有 loader 预取，直接跳过去会
          // isPending → 整页塌成 spinner → 编辑器（key={skillId}）重挂载，把用户
          // 在保存请求飞行期间敲的字一起丢掉。拿旧 key 的数据播种一份，跳转就无缝。
          // 上面那次 invalidate 打的是旧虚拟 key（精确到 input.id），冲不到这里。
          const previous = queryClient.getQueryData(
            trpc.skills.get.queryKey({ id: variables.id }),
          );
          if (previous) {
            queryClient.setQueryData(
              trpc.skills.get.queryKey({ id: result.id }),
              {
                ...previous,
                id: result.id,
                // previous 是内置行，updatedAt 是 new Date(0)；跳过去 id 已经不带
                // builtin: 前缀，页脚会照直显示「更新于 1970/1/1」。服务端刚写过这行，
                // 用本地 now 顶上，紧随其后的后台重取会校准成真值。
                updatedAt: new Date(),
                ...(variables.name != null ? { name: variables.name } : {}),
                ...(variables.description != null
                  ? { description: variables.description }
                  : {}),
                ...(variables.body != null ? { body: variables.body } : {}),
                ...(variables.enabled != null
                  ? { enabled: variables.enabled }
                  : {}),
              },
            );
          }
          void navigate({
            to: "/assistant/skills/$skillId",
            params: { skillId: result.id },
            replace: true,
          });
        }
      },
      onError: (error) => toast.error(resolveSkillErrorMessage(error)),
    }),
  );

  const deleteMutation = useMutation(
    trpc.skills.delete.mutationOptions({
      onSuccess: (_result, variables) => {
        invalidateList();
        // 这条的 get 缓存直接移除：invalidate 会促发一次注定 NOT_FOUND 的重取
        queryClient.removeQueries({
          queryKey: trpc.skills.get.queryKey({ id: variables.id }),
        });
        void navigate({ to: "/assistant/skills" });
      },
      onError: (error) => toast.error(resolveSkillErrorMessage(error)),
    }),
  );

  const handleCopy = async (values: SkillInput) => {
    try {
      await navigator.clipboard.writeText(formatSkillMarkdown(values));
      toast.success(m.assistant_skills_copied());
    } catch (err) {
      // 非安全上下文（非 localhost 的 http）下 clipboard API 不存在，或用户拒绝了
      // 权限，都会走到这里——不 catch 的话既没有失败提示，控制台还会多一条
      // 未处理的 promise rejection
      console.error("Failed to copy skill:", err);
      toast.error(m.assistant_skills_error_generic());
    }
  };

  if (isSessionPending) {
    return (
      <main className="page-wrap flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--academic-brown)]" />
      </main>
    );
  }

  // 未登录会被 useRequireAuth 送去登录页，这里不渲染任何东西
  if (!session) return null;

  const backLink = (
    <Link
      to="/assistant/skills"
      className="inline-flex items-center gap-1 rounded-sm text-xs text-[var(--ink-soft)] transition-colors hover:text-[var(--academic-brown)] focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:outline-none"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {m.assistant_skills_title()}
    </Link>
  );

  if (getQuery.isPending) {
    return (
      <main className="page-wrap py-8">
        {backLink}
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--academic-brown)]" />
        </div>
      </main>
    );
  }

  if (getQuery.isError) {
    return (
      <main className="page-wrap py-8">
        {backLink}
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-[var(--ink-soft)]">
            {resolveSkillErrorMessage(getQuery.error)}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void getQuery.refetch()}
          >
            {m.assistant_history_retry()}
          </Button>
        </div>
      </main>
    );
  }

  const skill = getQuery.data;
  const isBuiltin = isBuiltinId(skillId);
  // 内置行没有实体可删；已实体化（或用户自建的同名行）删掉后内置版本会回归，
  // 所以文案是「恢复默认」而不是「删除」
  const isResettable = !isBuiltin && BUILTIN_SKILL_NAMES.has(skill.name);
  const deleteLabel = isResettable
    ? m.assistant_skills_reset()
    : m.assistant_skills_delete();
  const deleteConfirmLabel = isResettable
    ? m.assistant_skills_reset_confirm()
    : m.assistant_skills_delete_confirm();
  const initial: SkillInput = {
    name: skill.name,
    description: skill.description,
    body: skill.body,
  };

  // 列表开关也走 update，但不该让编辑器的保存按钮跟着转圈：只认带 body 的那次
  const isSaving =
    updateMutation.isPending && updateMutation.variables?.body != null;
  const isTogglingEnabled =
    updateMutation.isPending &&
    updateMutation.variables?.enabled != null &&
    updateMutation.variables?.body == null;

  return (
    <main className="page-wrap py-8">
      {backLink}

      <h1 className="mt-2 truncate font-mono text-2xl text-[var(--ink)]">
        /{skill.name}
      </h1>

      <div className="mt-6">
        <SkillDocumentEditor
          key={skillId}
          initial={initial}
          isSaving={isSaving}
          onSave={(values) => updateMutation.mutate({ id: skillId, ...values })}
          onCopy={handleCopy}
          headerActions={
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <Switch
                  size="sm"
                  checked={skill.enabled}
                  onCheckedChange={(enabled) =>
                    updateMutation.mutate({ id: skillId, enabled })
                  }
                  disabled={isTogglingEnabled}
                  aria-label={`${m.assistant_skills_enabled()}: ${skill.name}`}
                />
                <span className="text-[11px] text-[var(--ink-soft)]">
                  {m.assistant_skills_enabled()}
                </span>
              </span>
              {/* 内置行没有实体可删，连按钮都不该出现 */}
              {!isBuiltin &&
                (isConfirmingDelete ? (
                  <span className="flex items-center gap-1 rounded-md bg-[var(--parchment-warm)] px-2 py-1">
                    <span className="text-xs text-[var(--ink-soft)]">
                      {deleteConfirmLabel}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => deleteMutation.mutate({ id: skillId })}
                      disabled={deleteMutation.isPending}
                      aria-label={deleteLabel}
                      title={deleteLabel}
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5 text-[var(--sienna)]" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setIsConfirmingDelete(false)}
                      aria-label={m.cancel()}
                      title={m.cancel()}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsConfirmingDelete(true)}
                    className="text-[var(--sienna)] hover:text-[var(--sienna)]"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="max-sm:sr-only">{deleteLabel}</span>
                  </Button>
                ))}
            </div>
          }
          footerMeta={
            <span>
              {isBuiltin
                ? m.assistant_skills_builtin()
                : m.assistant_skills_updated_at({
                    date: skill.updatedAt.toLocaleDateString(getLocale()),
                  })}
            </span>
          }
          // 停用的技能不会出现在 slash 候选里，链接过去也匹配不到任何东西——
          // 点了会静默无事发生，不如干脆不渲染
          footerAction={
            skill.enabled && (
              <Link
                to="/assistant"
                state={{ pendingSkillName: skill.name }}
                className="text-[var(--academic-brown)] transition-colors hover:text-[var(--academic-brown-deep)]"
              >
                {m.assistant_skills_open_chat()} →
              </Link>
            )
          }
        />
      </div>
    </main>
  );
}
