// 方向编辑表单。整页最重要的一条视觉区分在这里：focusBrief 是喂给 LLM 的内部
// 中文提示词（mono、暖底、左侧一道棕线），intro / name 是给读者看的公开文案
// （常规排版）。两者改错方向的代价不对称，所以让它们长得完全不一样。
import { useMutation } from "@tanstack/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { Loader2, Play, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
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
  useInvalidateAdmin,
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
  const invalidateAdmin = useInvalidateAdmin();
  const fieldId = useId();

  /**
   * 表单是草稿：本地 state 只在挂载时从 prop 取一次，之后 refetch 不会覆盖它
   * （覆盖就会抹掉站长正在敲的字）。代价是库里被旁路改动后表单会陈旧——同一页
   * 上「采纳提案」就是那条旁路，它直接覆盖 focusBrief，表单若照旧保存就把刚采纳
   * 的演化整段写回去，且没有任何提示。所以留一份挂载时的基线，用服务端的
   * updatedAt 当唯一的陈旧令牌（逐字段比会把站长自己的编辑误判成漂移）。
   */
  const [baseline, setBaseline] = useState(direction);
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
  /**
   * 校验失败的字段与文案一起存：错误文字在长表单的最底部，出问题的输入框却可能在
   * 最顶上，得靠 aria-invalid / aria-describedby 把两者接起来。
   */
  const [formError, setFormError] = useState<{
    field: "slug" | "sortOrder" | "name" | "focusBrief" | "intro";
    message: string;
  } | null>(null);
  const errorId = `${fieldId}-error`;
  /** 站长动了任何一个字段就撤掉旧错误，否则改好了错误仍挂在那儿 */
  const clearError = () => setFormError(null);

  /**
   * 本表单自己发起的写入（目前只有「生成简介」——它落库后表单继续开着）也会推进
   * updatedAt。不认领的话，refetch 回来就把自己的写入当成别处的漂移锁死表单。
   * 认领窗口只覆盖下一次 direction 变化，覆盖不到「生成简介期间恰好有人采纳提案」
   * 这种同窗竞态——单人使用的管理台，不为它加版本号。
   */
  const claimNextUpdateRef = useRef(false);
  useEffect(() => {
    if (claimNextUpdateRef.current && direction) {
      claimNextUpdateRef.current = false;
      setBaseline(direction);
    }
  }, [direction]);

  const drifted =
    direction !== null &&
    baseline !== null &&
    direction.updatedAt.getTime() !== baseline.updatedAt.getTime();

  /** 放弃草稿，把六个 state 连同基线一起换成服务端最新那份 */
  const reloadFromServer = () => {
    if (!direction) return;
    setBaseline(direction);
    setSlug(direction.slug);
    setName(toLocaleDraft(direction.name));
    setSortOrder(String(direction.sortOrder));
    setIsActive(direction.isActive);
    setFocusBrief(direction.focusBrief);
    setIntro(toLocaleDraft(direction.intro));
    setIntroDirty(false);
    setFormError(null);
  };

  const upsert = useMutation(
    trpc.admin.upsertDirection.mutationOptions({
      onSuccess: () => {
        invalidateAdmin();
        toast.success(m.admin_saved());
        onDone();
      },
      onError: (error) => toast.error(adminErrorMessage(error)),
    }),
  );

  const generateIntro = useMutation(
    trpc.admin.generateIntro.mutationOptions({
      onSuccess: (data) => {
        // 服务端已经落库了，这里回填只是让表单显示的与库里一致。基线要跟着推进：
        // 这次写入是本表单发起的，不该被自己的漂移检测判成「别处改了」。
        setIntro(toLocaleDraft(data.intro));
        setIntroDirty(true);
        claimNextUpdateRef.current = true;
        invalidateAdmin();
        toast.success(m.admin_saved());
      },
      onError: (error) => toast.error(adminErrorMessage(error)),
    }),
  );

  const triggerDigest = useMutation(
    trpc.admin.triggerDigest.mutationOptions({
      onSuccess: (data) => {
        // 这次 refetch 几乎必然早于 digest 行的出现：那一行是 Workflow 第一步
        // （ensureDigestShell）才插的，而 create() 一返回就到这里了。刷新页面即可
        // 看到；不为此加轮询——站长手动触发本就不是高频操作。
        invalidateAdmin();
        toast.success(m.admin_trigger_done({ id: data.instanceId }));
      },
      onError: (error) => toast.error(adminErrorMessage(error)),
    }),
  );

  const deleteDirection = useMutation(
    trpc.admin.deleteDirection.mutationOptions({
      onSuccess: (result) => {
        if (result.deleted) {
          invalidateAdmin();
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

  // 「生成简介」是几十秒的 LLM 调用，期间只锁保存，不锁取消——否则站长在这几十秒里
  // 退不出这张表单
  const saveBusy =
    upsert.isPending || deleteDirection.isPending || generateIntro.isPending;

  const submit = () => {
    const trimmedSlug = slug.trim();
    if (!SLUG_RE.test(trimmedSlug) || trimmedSlug.length > 50) {
      setFormError({ field: "slug", message: m.admin_slug_invalid() });
      return;
    }
    // parseInt 会把 "" 读成 NaN、把 "1e5" 读成 1：两种都是「排序被悄悄改掉」，
    // 所以只接受一个规规矩矩的十进制整数
    const trimmedSort = sortOrder.trim();
    const parsedSortOrder = Number(trimmedSort);
    if (
      !/^-?\d+$/.test(trimmedSort) ||
      !Number.isSafeInteger(parsedSortOrder)
    ) {
      setFormError({
        field: "sortOrder",
        message: m.admin_sort_order_invalid(),
      });
      return;
    }
    const trimmedBrief = focusBrief.trim();
    if (!trimmedBrief) {
      setFormError({
        field: "focusBrief",
        message: m.admin_focus_brief_required(),
      });
      return;
    }
    // name 的 zod 校验是穷尽的：缺一语就是一个说不清缘由的 400，在这里说清楚
    if (LOCALE_KEYS.some((key) => !name[key].trim())) {
      setFormError({ field: "name", message: m.admin_name_incomplete() });
      return;
    }

    let introField: LocaleRecord | null | undefined;
    if (introDirty) {
      const filled = LOCALE_KEYS.filter((key) => intro[key].trim());
      if (filled.length === 0) introField = null;
      else if (filled.length < LOCALE_KEYS.length) {
        setFormError({ field: "intro", message: m.admin_intro_incomplete() });
        return;
      } else introField = trimmedLocaleRecord(intro);
    }

    setFormError(null);
    upsert.mutate({
      ...(direction ? { id: direction.id } : {}),
      slug: trimmedSlug,
      name: trimmedLocaleRecord(name),
      focusBrief: trimmedBrief,
      isActive,
      sortOrder: parsedSortOrder,
      ...(introField === undefined ? {} : { intro: introField }),
    });
  };

  const introEmpty = LOCALE_KEYS.every((key) => !intro[key].trim());
  /** 屏幕上的 brief 与库里那份不一致时，「生成简介」会拿旧 brief 去生成并落库 */
  const briefUnsaved =
    direction !== null && focusBrief.trim() !== direction.focusBrief;

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
            aria-invalid={formError?.field === "slug"}
            aria-describedby={formError?.field === "slug" ? errorId : undefined}
            onChange={(event) => {
              clearError();
              setSlug(event.target.value);
            }}
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
            aria-invalid={formError?.field === "sortOrder"}
            aria-describedby={
              formError?.field === "sortOrder" ? errorId : undefined
            }
            onChange={(event) => {
              clearError();
              setSortOrder(event.target.value);
            }}
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
                aria-invalid={formError?.field === "name" && !name[key].trim()}
                aria-describedby={
                  formError?.field === "name" ? errorId : undefined
                }
                onChange={(event) => {
                  clearError();
                  setName((prev) => ({ ...prev, [key]: event.target.value }));
                }}
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
          aria-invalid={formError?.field === "focusBrief"}
          aria-describedby={
            formError?.field === "focusBrief" ? errorId : undefined
          }
          onChange={(event) => {
            clearError();
            setFocusBrief(event.target.value);
          }}
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
              // 两个限制：真实 LLM 调用几十秒起步，不锁住会被连点成几次付费请求；
              // 而且服务端读的是**库里**的 focusBrief（generateIntro 只收 directionId），
              // 未保存的改动生成出来的是旧 brief 的简介、还立刻落库，所以先逼着保存
              disabled={briefUnsaved || generateIntro.isPending}
              title={briefUnsaved ? m.admin_save_brief_first() : undefined}
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
                aria-invalid={
                  formError?.field === "intro" && !intro[key].trim()
                }
                aria-describedby={
                  formError?.field === "intro" ? errorId : undefined
                }
                onChange={(event) => {
                  clearError();
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

      {/* 库里被旁路改过（多半是刚在下面采纳了这个方向的提案）：锁住保存，
          否则这份草稿会把刚落库的新 focusBrief 整段覆盖回旧全文 */}
      {drifted ? (
        <div
          className="flex flex-wrap items-center gap-3"
          data-testid="admin-direction-stale"
        >
          <FormNote tone="error">{m.admin_stale_refresh()}</FormNote>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="admin-direction-reload"
            onClick={reloadFromServer}
          >
            <RefreshCw className="size-3.5" />
            {m.admin_reload_from_server()}
          </Button>
        </div>
      ) : null}

      {formError ? (
        <FormNote tone="error" id={errorId}>
          {formError.message}
        </FormNote>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-4">
        <Button
          type="button"
          size="sm"
          disabled={saveBusy || drifted}
          data-testid="admin-save-direction"
          onClick={submit}
        >
          {upsert.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {m.admin_save()}
        </Button>
        {/* 取消刻意不受 saveBusy 约束：生成简介要几十秒，锁住它站长就退不出去 */}
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {m.admin_cancel()}
        </Button>
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
              className="ml-auto"
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
