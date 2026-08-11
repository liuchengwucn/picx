// 方向编辑表单。整页最重要的一条视觉区分在这里：focusBrief 是喂给 LLM 的内部
// 中文提示词（mono、暖底、左侧一道棕线），intro / name 是给读者看的公开文案
// （常规排版）。两者改错方向的代价不对称，所以让它们长得完全不一样。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { Loader2, Play, Sparkles } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  adminErrorMessage,
  ConfirmButton,
  FieldLabel,
  FormNote,
  LOCALE_KEYS,
  LOCALE_LABELS,
  type LocaleDraft,
  toLocaleDraft,
} from "#/components/admin/admin-ui";
import { SourceList } from "#/components/admin/source-list";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { useTRPC } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { m } from "#/paraglide/messages";

type AdminDirection =
  inferRouterOutputs<TRPCRouter>["admin"]["listDirections"][number];
type UpsertDirectionInput =
  inferRouterInputs<TRPCRouter>["admin"]["upsertDirection"];
type LocaleRecord = UpsertDirectionInput["name"];

/** 与后端 slug 正则逐字一致：连字符只能做分隔符 */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function trimmedLocaleRecord(draft: LocaleDraft): LocaleRecord {
  return {
    en: draft.en.trim(),
    "zh-cn": draft["zh-cn"].trim(),
    "zh-tw": draft["zh-tw"].trim(),
    ja: draft.ja.trim(),
  };
}

export function DirectionForm({
  direction,
  onDone,
}: {
  direction: AdminDirection | null;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const fieldId = useId();

  const [slug, setSlug] = useState(direction?.slug ?? "");
  const [name, setName] = useState<LocaleDraft>(() =>
    toLocaleDraft(direction?.name),
  );
  const [sortOrder, setSortOrder] = useState(String(direction?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(direction?.isActive ?? true);
  const [focusBrief, setFocusBrief] = useState(direction?.focusBrief ?? "");
  const [intro, setIntro] = useState<LocaleDraft>(() =>
    toLocaleDraft(direction?.intro),
  );
  /**
   * intro 的三态全靠这一位：false = 本次编辑没碰过 intro，提交时**不传该字段**，
   * 后端保持原值；true 且四框全空 = 显式传 null 清空；true 且四语齐全 = 传对象覆盖。
   * 「没改」和「清空」发同一个 null 会把生成好的公开简介悄悄抹掉。
   */
  const [introDirty, setIntroDirty] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const invalidateDirections = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.admin.listDirections.queryKey(),
    });

  const upsert = useMutation(
    trpc.admin.upsertDirection.mutationOptions({
      onSuccess: () => {
        void invalidateDirections();
        toast.success(m.admin_saved());
        onDone();
      },
      onError: (error) => toast.error(adminErrorMessage(error)),
    }),
  );

  const generateIntro = useMutation(
    trpc.admin.generateIntro.mutationOptions({
      onSuccess: (data) => {
        // generateIntro 服务端已经落库了，这里回填只是让表单显示的和库里一致
        setIntro(toLocaleDraft(data.intro));
        setIntroDirty(true);
        void invalidateDirections();
        toast.success(m.admin_saved());
      },
      onError: (error) => toast.error(adminErrorMessage(error)),
    }),
  );

  const triggerDigest = useMutation(
    trpc.admin.triggerDigest.mutationOptions({
      onSuccess: (data) => {
        void queryClient.invalidateQueries({
          queryKey: trpc.admin.listRecentDigests.queryKey(),
        });
        toast.success(m.admin_trigger_done({ id: data.instanceId }));
      },
      onError: (error) => toast.error(adminErrorMessage(error)),
    }),
  );

  const deleteDirection = useMutation(
    trpc.admin.deleteDirection.mutationOptions({
      onSuccess: (result) => {
        if (result.deleted) {
          void invalidateDirections();
          toast.success(m.admin_saved());
          onDone();
          return;
        }
        // 三种 reason 是三件不同的事：历史存在 = 永远删不掉（只能停用）；
        // 还启用着 = 先停用再来；不存在 = 另一个标签页已经删过了。
        toast.error(
          result.reason === "has_history"
            ? m.admin_delete_blocked_history()
            : result.reason === "still_active"
              ? m.admin_delete_blocked_active()
              : m.admin_delete_blocked_missing(),
        );
      },
      onError: (error) => toast.error(adminErrorMessage(error)),
    }),
  );

  const busy =
    upsert.isPending || deleteDirection.isPending || generateIntro.isPending;

  const submit = () => {
    const trimmedSlug = slug.trim();
    if (!SLUG_RE.test(trimmedSlug) || trimmedSlug.length > 50) {
      setFormError(m.admin_slug_invalid());
      return;
    }
    const trimmedBrief = focusBrief.trim();
    if (!trimmedBrief) {
      setFormError(m.admin_focus_brief_required());
      return;
    }
    // name 的 zod 校验是穷尽的：缺一语就是一个说不清缘由的 400，在这里说清楚
    if (LOCALE_KEYS.some((key) => !name[key].trim())) {
      setFormError(m.admin_name_incomplete());
      return;
    }

    let introField: LocaleRecord | null | undefined;
    if (introDirty) {
      const filled = LOCALE_KEYS.filter((key) => intro[key].trim());
      if (filled.length === 0) introField = null;
      else if (filled.length < LOCALE_KEYS.length) {
        setFormError(m.admin_intro_incomplete());
        return;
      } else introField = trimmedLocaleRecord(intro);
    }

    setFormError(null);
    const parsedSortOrder = Number.parseInt(sortOrder, 10);
    upsert.mutate({
      ...(direction ? { id: direction.id } : {}),
      slug: trimmedSlug,
      name: trimmedLocaleRecord(name),
      focusBrief: trimmedBrief,
      isActive,
      sortOrder: Number.isNaN(parsedSortOrder) ? 0 : parsedSortOrder,
      ...(introField === undefined ? {} : { intro: introField }),
    });
  };

  const introEmpty = LOCALE_KEYS.every((key) => !intro[key].trim());

  return (
    <div className="space-y-6" data-testid="admin-direction-form">
      {/* 身份：slug / 排序 / 启用 */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-56">
          <FieldLabel htmlFor={`${fieldId}-slug`}>
            {m.admin_field_slug()}
          </FieldLabel>
          <Input
            id={`${fieldId}-slug`}
            value={slug}
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-sm"
            data-testid="admin-direction-slug"
            onChange={(event) => setSlug(event.target.value)}
          />
        </div>
        <div className="w-24">
          <FieldLabel htmlFor={`${fieldId}-sort`}>
            {m.admin_field_sort_order()}
          </FieldLabel>
          <Input
            id={`${fieldId}-sort`}
            type="number"
            value={sortOrder}
            className="font-mono text-sm tabular-nums"
            onChange={(event) => setSortOrder(event.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch
            id={`${fieldId}-active`}
            checked={isActive}
            data-testid="admin-direction-active"
            onCheckedChange={setIsActive}
          />
          <label
            htmlFor={`${fieldId}-active`}
            className="text-xs font-semibold text-[var(--ink-soft)]"
          >
            {m.admin_field_active()}
          </label>
        </div>
      </div>

      {/* 公开：四语名称 */}
      {/* 不套 fieldset/role=group：四个输入框各自的 aria-label 已经带上了
          「名称 — English」这样的全称，再包一层只是多一次朗读 */}
      <div>
        <p className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">
          {m.admin_field_name()}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {LOCALE_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[0.7rem] text-[var(--ink-soft)]">
                {LOCALE_LABELS[key]}
              </span>
              <Input
                value={name[key]}
                aria-label={`${m.admin_field_name()} — ${LOCALE_LABELS[key]}`}
                data-testid={`admin-direction-name-${key}`}
                onChange={(event) =>
                  setName((prev) => ({ ...prev, [key]: event.target.value }))
                }
              />
            </div>
          ))}
        </div>
      </div>

      {/* 内部：喂给 LLM 的中文提示词。整块换成 mono + 暖底 + 左侧棕线 */}
      <div className="border-l-2 border-[var(--academic-brown)] bg-[var(--parchment-warm)] py-3 pr-3 pl-4">
        <FieldLabel htmlFor={`${fieldId}-brief`}>
          {m.admin_field_focus_brief()}
        </FieldLabel>
        <Textarea
          id={`${fieldId}-brief`}
          value={focusBrief}
          rows={8}
          spellCheck={false}
          className="bg-[var(--parchment)] font-mono text-xs leading-relaxed"
          data-testid="admin-direction-focus-brief"
          onChange={(event) => setFocusBrief(event.target.value)}
        />
      </div>

      {/* 公开：四语简介，由上面那段生成 */}
      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-[var(--ink-soft)]">
            {m.admin_field_intro()}
          </p>
          {direction ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              // 真实 LLM 调用，几十秒起步；不锁住就会被连点成几次付费请求
              disabled={generateIntro.isPending}
              data-testid="admin-generate-intro"
              onClick={() =>
                generateIntro.mutate({ directionId: direction.id })
              }
            >
              {generateIntro.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  {m.admin_generating_intro()}
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" />
                  {m.admin_generate_intro()}
                </>
              )}
            </Button>
          ) : null}
        </div>
        {introEmpty ? (
          <p className="mb-2 text-xs text-[var(--sienna)]">
            {m.admin_intro_missing()}
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {LOCALE_KEYS.map((key) => (
            <div key={key}>
              <span className="mb-1 block text-[0.7rem] text-[var(--ink-soft)]">
                {LOCALE_LABELS[key]}
              </span>
              <Textarea
                value={intro[key]}
                rows={3}
                aria-label={`${m.admin_field_intro()} — ${LOCALE_LABELS[key]}`}
                className="text-sm"
                data-testid={`admin-direction-intro-${key}`}
                onChange={(event) => {
                  setIntroDirty(true);
                  setIntro((prev) => ({ ...prev, [key]: event.target.value }));
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 源清单只有已保存的方向才有：新建方向还没有 id 可挂 */}
      {direction ? (
        <div className="border-t border-[var(--line)] pt-4">
          <SourceList directionId={direction.id} sources={direction.sources} />
        </div>
      ) : null}

      {formError ? <FormNote tone="error">{formError}</FormNote> : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-4">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          data-testid="admin-save-direction"
          onClick={submit}
        >
          {upsert.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {m.admin_save()}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onDone}
        >
          {m.admin_cancel()}
        </Button>
        <span className="flex-1" />
        {direction ? (
          <>
            {/* 实例 id 精确到秒，同方向 1 秒内两次触发会撞 id：pending 期间必须锁住 */}
            <ConfirmButton
              label={
                <>
                  {triggerDigest.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  {m.admin_trigger_digest()}
                </>
              }
              confirmLabel={m.admin_trigger_confirm()}
              disabled={triggerDigest.isPending}
              data-testid="admin-trigger-digest"
              onConfirm={() =>
                triggerDigest.mutate({ directionId: direction.id })
              }
            />
            <ConfirmButton
              label={m.admin_delete()}
              confirmLabel={m.admin_delete_confirm()}
              variant="outline"
              className="text-[var(--sienna)]"
              disabled={deleteDirection.isPending}
              data-testid="admin-delete-direction"
              onConfirm={() =>
                deleteDirection.mutate({ directionId: direction.id })
              }
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
