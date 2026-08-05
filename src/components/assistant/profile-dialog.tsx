import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPen } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { resolveChatErrorMessage } from "#/components/chat/chat-message";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

/** 与 assistant router 的 PROFILE_MAX_CHARS 对齐，超出会被 tRPC 直接拒掉 */
const PROFILE_MAX_CHARS = 4000;
/** 快写满时才露出计数器，平时不干扰书写（同输入区的做法） */
const COUNTER_VISIBLE_FROM = Math.floor(PROFILE_MAX_CHARS * 0.9);

/**
 * 个人档案编辑器。档案是助手每轮对话都会读到的长期记忆，agent 自己也会写它，
 * 所以每次打开都重取一遍再灌进输入框，别让用户对着一份过期的稿子改。
 */
export function ProfileDialog() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  /** 输入框已被最新档案灌过一次；false 时显示加载态而不是空白稿 */
  const [seeded, setSeeded] = useState(false);

  const profileQuery = useQuery({
    ...trpc.assistant.getProfile.queryOptions(),
    // 只在对话框开着时取，且每次开都当过期重取：agent 可能刚在对话里改过它
    enabled: open,
    staleTime: 0,
  });

  // 等这一轮取数落定再灌（缓存里的旧值会先到，直接用会把 agent 刚写的改动盖掉）
  const isSettled = profileQuery.isSuccess && !profileQuery.isFetching;
  useEffect(() => {
    if (!open) {
      setSeeded(false);
      return;
    }
    if (seeded || !isSettled) return;
    setContent(profileQuery.data?.content ?? "");
    setSeeded(true);
  }, [open, seeded, isSettled, profileQuery.data]);

  const updateMutation = useMutation(
    trpc.assistant.updateProfile.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.assistant.getProfile.queryKey(),
        });
        toast.success(m.assistant_profile_saved());
        setOpen(false);
      },
      // guest 的 FORBIDDEN 也走这里，与本页其他 tRPC 错误同一套文案
      onError: (error) => toast.error(resolveChatErrorMessage(error)),
    }),
  );

  const updatedAt = profileQuery.data?.updatedAt;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={m.assistant_profile()}>
          <UserPen className="h-4 w-4" />
          <span className="max-md:sr-only">{m.assistant_profile()}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="border-[var(--line)] bg-[var(--parchment)] sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-[var(--ink)]">
            {m.assistant_profile()}
          </DialogTitle>
          <DialogDescription className="text-[var(--ink-soft)]">
            {m.assistant_profile_hint()}
          </DialogDescription>
        </DialogHeader>

        {profileQuery.isError && !seeded ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-[var(--ink-soft)]">
              {resolveChatErrorMessage(profileQuery.error)}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void profileQuery.refetch()}
            >
              {m.assistant_history_retry()}
            </Button>
          </div>
        ) : !seeded ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--academic-brown)]" />
          </div>
        ) : (
          <div>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={PROFILE_MAX_CHARS}
              rows={10}
              placeholder={m.assistant_profile_placeholder()}
              aria-label={m.assistant_profile()}
              className="w-full resize-none rounded-md border border-[var(--line)] bg-[var(--parchment-warm)]/50 px-3 py-2 text-sm leading-relaxed text-[var(--ink)] transition-colors outline-none placeholder:text-[var(--ink-soft)] focus:border-[var(--academic-brown)]/60"
            />
            {content.length >= COUNTER_VISIBLE_FROM && (
              <p className="mt-1 text-right text-[11px] tabular-nums text-[var(--ink-soft)]">
                {content.length} / {PROFILE_MAX_CHARS}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="sm:items-center sm:justify-between">
          <p className="text-[11px] text-[var(--ink-soft)]">
            {updatedAt
              ? m.assistant_profile_updated_at({
                  date: new Date(updatedAt).toLocaleDateString(getLocale()),
                })
              : ""}
          </p>
          <Button
            onClick={() => updateMutation.mutate({ content })}
            disabled={!seeded || updateMutation.isPending}
          >
            {updateMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {m.assistant_profile_save()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
