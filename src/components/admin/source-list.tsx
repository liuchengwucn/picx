// 一个方向的抓取源清单。源是「内部机器配置」那一侧的东西，所以整块用 mono
// 排版：config 是原样喂给适配器的 JSON，adapterType 是枚举字面量，都不该被
// 翻译或美化成散文。
import { useMutation } from "@tanstack/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { Pencil, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  AdminEmpty,
  adminErrorMessage,
  ConfirmButton,
  FieldLabel,
  FormNote,
  Pill,
  useInvalidateAdmin,
} from "#/components/admin/admin-ui";
import { Button } from "#/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { useTRPC } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { m } from "#/paraglide/messages";

type AdminSource =
  inferRouterOutputs<TRPCRouter>["admin"]["listDirections"][number]["sources"][number];
type AdapterType = AdminSource["adapterType"];
type SourceConfigInput =
  inferRouterInputs<TRPCRouter>["admin"]["upsertSource"]["config"];

const ADAPTER_TYPES: AdapterType[] = ["arxiv_query", "rss"];

/**
 * 新建源时的 config 骨架。孤零零一个 `{}` 会让站长去猜字段名，而字段名拼错
 * （zod 会静默剥掉未知键）表现为「保存成功但永远抓不到东西」。
 */
const CONFIG_TEMPLATES: Record<AdapterType, string> = {
  arxiv_query:
    '{\n  "query": "cat:cs.LO AND abs:formalization",\n  "maxResults": 50\n}',
  rss: '{\n  "url": "https://example.com/feed.xml"\n}',
};
const TEMPLATE_VALUES = Object.values(CONFIG_TEMPLATES);

/**
 * 折叠行里那一眼。query / url 是这条源的身份，优先显示；两者都没有时（比如只填了
 * maxResults）退回紧凑 JSON —— 固定显示 "{}" 会让人以为配置是空的。
 */
function configSummary(source: AdminSource): string {
  return (
    source.config.query ?? source.config.url ?? JSON.stringify(source.config)
  );
}

/** 一条源上「这张表单能改的全部内容」的指纹，null = 新建（永不漂移） */
function sourceFingerprint(source: AdminSource | null): string | null {
  if (!source) return null;
  return JSON.stringify([source.adapterType, source.config, source.enabled]);
}

export function SourceList({
  directionId,
  sources,
}: {
  directionId: string;
  sources: AdminSource[];
}) {
  const trpc = useTRPC();
  const invalidateAdmin = useInvalidateAdmin();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const deleteSource = useMutation(
    trpc.admin.deleteSource.mutationOptions({
      onSuccess: () => {
        invalidateAdmin();
        toast.success(m.admin_saved());
      },
      onError: (error) => toast.error(adminErrorMessage(error)),
    }),
  );

  const reviveSource = useMutation(
    trpc.admin.reviveSource.mutationOptions({
      onSuccess: () => {
        invalidateAdmin();
        toast.success(m.admin_saved());
      },
      onError: (error) => toast.error(adminErrorMessage(error)),
    }),
  );

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-xs font-semibold text-[var(--ink-soft)]">
          {m.admin_sources()}
        </h4>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid="admin-add-source"
          onClick={() => {
            setAdding((v) => !v);
            setEditingId(null);
          }}
        >
          <Plus className="size-3.5" />
          {m.admin_add_source()}
        </Button>
      </div>

      {sources.length === 0 && !adding ? (
        <AdminEmpty>{m.admin_no_sources()}</AdminEmpty>
      ) : null}

      <ul className="divide-y divide-[var(--line)]">
        {sources.map((source) => (
          <li key={source.id} className="py-3" data-testid="admin-source-row">
            {editingId === source.id ? (
              <SourceForm
                directionId={directionId}
                source={source}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-mono text-xs text-[var(--academic-brown-deep)]">
                  {source.adapterType}
                </span>
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--ink)]">
                  {configSummary(source)}
                </code>
                <SourceHealth source={source} />
                {source.enabled ? null : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={reviveSource.isPending}
                    data-testid="admin-revive-source"
                    onClick={() => reviveSource.mutate({ sourceId: source.id })}
                  >
                    <RotateCcw className="size-3.5" />
                    {m.admin_revive_source()}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`${m.admin_field_config()} — ${source.adapterType}`}
                  data-testid="admin-edit-source"
                  onClick={() => {
                    setEditingId(source.id);
                    setAdding(false);
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <ConfirmButton
                  label={m.admin_delete()}
                  confirmLabel={m.admin_delete_confirm()}
                  disabled={deleteSource.isPending}
                  // 一个方向可能挂着好几条源，读屏下几个按钮都叫「删除」分不出是哪条
                  description={`${source.adapterType} ${configSummary(source)}`}
                  onConfirm={() => deleteSource.mutate({ sourceId: source.id })}
                  data-testid="admin-delete-source"
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="mt-3 border-t border-[var(--line)] pt-3">
          <SourceForm
            directionId={directionId}
            source={null}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * 健康态。enabled=false 一律显示「已熔断」（熔断器关掉源与手动停用在库里是同一个
 * 字段，无从区分），但失败计数是独立信息，非零就照样显示，两枚徽标可以同时在。
 */
function SourceHealth({ source }: { source: AdminSource }) {
  const failures = source.consecutiveFailures;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {source.enabled ? null : (
        <Pill tone="bad" title={source.lastError ?? undefined}>
          {m.admin_source_tripped()}
        </Pill>
      )}
      {failures === 0 ? (
        source.enabled ? (
          <Pill tone="ok">{m.admin_source_health_ok()}</Pill>
        ) : null
      ) : (
        <Pill tone="warn" title={source.lastError ?? undefined}>
          {m.admin_source_failures({ count: String(failures) })}
        </Pill>
      )}
    </span>
  );
}

function SourceForm({
  directionId,
  source,
  onDone,
}: {
  directionId: string;
  source: AdminSource | null;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const invalidateAdmin = useInvalidateAdmin();
  const fieldId = useId();
  /**
   * 与 DirectionForm 同一个问题的小号版：本地 state 只在挂载时取一次，refetch 不覆盖
   * （否则抹掉正在敲的 JSON），于是别处改了这条源之后一保存就把那次改动写回去。
   * direction_sources 没有 updatedAt 列（也不为此加迁移），所以拿三个可写字段的
   * 序列化形态当基线——它们就是这张表单能改的全部内容，够判漂移。
   */
  const [baseline, setBaseline] = useState(() => sourceFingerprint(source));
  const [adapterType, setAdapterType] = useState<AdapterType>(
    source?.adapterType ?? "arxiv_query",
  );
  const [configText, setConfigText] = useState(() =>
    source
      ? JSON.stringify(source.config, null, 2)
      : CONFIG_TEMPLATES.arxiv_query,
  );
  const [enabled, setEnabled] = useState(source?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  const drifted = sourceFingerprint(source) !== baseline;

  /** 原地重置成服务端最新那份，与方向表单的「重新载入」同一语义（不是关掉表单） */
  const reloadFromServer = () => {
    if (!source) return;
    setBaseline(sourceFingerprint(source));
    setAdapterType(source.adapterType);
    setConfigText(JSON.stringify(source.config, null, 2));
    setEnabled(source.enabled);
    setError(null);
  };

  const upsert = useMutation(
    trpc.admin.upsertSource.mutationOptions({
      onSuccess: () => {
        invalidateAdmin();
        toast.success(m.admin_saved());
        onDone();
      },
      onError: (mutationError) => toast.error(adminErrorMessage(mutationError)),
    }),
  );

  const submit = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configText);
    } catch {
      setError(m.admin_field_config_invalid());
      return;
    }
    // 数组和标量都能过 JSON.parse，但 zod 那边只接受对象 —— 在这里拦住，
    // 免得站长收到一个说不清哪里错了的 400
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      setError(m.admin_field_config_invalid());
      return;
    }
    setError(null);
    upsert.mutate({
      ...(source ? { id: source.id } : {}),
      // 更新分支后端会忽略 directionId（源不能在方向间搬家），但输入 schema 要求必传
      directionId,
      adapterType,
      config: parsed as SourceConfigInput,
      enabled,
    });
  };

  return (
    <div className="space-y-3" data-testid="admin-source-form">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <FieldLabel htmlFor={`${fieldId}-adapter`}>
            {m.admin_field_adapter()}
          </FieldLabel>
          <Select
            value={adapterType}
            onValueChange={(value) => {
              const next = value as AdapterType;
              setAdapterType(next);
              // 只在站长还没自己写过 config 时替换骨架，绝不覆盖手写内容
              if (
                !source &&
                (configText.trim() === "" ||
                  TEMPLATE_VALUES.includes(configText))
              ) {
                setConfigText(CONFIG_TEMPLATES[next]);
              }
            }}
          >
            <SelectTrigger
              id={`${fieldId}-adapter`}
              className="w-44 font-mono text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADAPTER_TYPES.map((type) => (
                <SelectItem key={type} value={type} className="font-mono">
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch
            id={`${fieldId}-enabled`}
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <label
            htmlFor={`${fieldId}-enabled`}
            className="text-xs font-semibold text-[var(--ink-soft)]"
          >
            {m.admin_field_enabled()}
          </label>
        </div>
      </div>

      <div>
        <FieldLabel htmlFor={`${fieldId}-config`}>
          {m.admin_field_config()}
        </FieldLabel>
        <Textarea
          id={`${fieldId}-config`}
          value={configText}
          spellCheck={false}
          rows={4}
          className="font-mono text-xs"
          aria-invalid={error !== null}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          onChange={(event) => {
            // 站长动了 JSON 就撤掉旧的「配置必须是合法 JSON」，否则改好了它还挂着
            setError(null);
            setConfigText(event.target.value);
          }}
        />
      </div>

      {error ? (
        <FormNote tone="error" id={`${fieldId}-error`}>
          {error}
        </FormNote>
      ) : null}

      {/* 这条源在别处被改过了：锁住保存，否则这份草稿会把那次改动写回去 */}
      {drifted ? (
        <div
          className="flex flex-wrap items-center gap-3"
          data-testid="admin-source-stale"
        >
          <FormNote tone="error">{m.admin_source_drifted()}</FormNote>
          <ConfirmButton
            label={
              <>
                <RefreshCw className="size-3.5" />
                {m.admin_reload_from_server()}
              </>
            }
            confirmLabel={m.admin_reload_confirm()}
            data-testid="admin-source-reload"
            onConfirm={reloadFromServer}
          />
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={upsert.isPending || drifted}
          data-testid="admin-save-source"
          onClick={submit}
        >
          {m.admin_save()}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {m.admin_cancel()}
        </Button>
      </div>
    </div>
  );
}
