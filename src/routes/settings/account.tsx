import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import {
  RowTitle,
  SettingsRow,
  SettingsSection,
} from "#/components/settings/settings-primitives";
import { useEffectiveSession } from "#/hooks/use-effective-session";
import { signOutAndReset, startGitHubSignIn } from "#/lib/auth-client";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/settings/account")({
  component: AccountSettingsPage,
  head: () => ({ meta: [{ title: m.page_title_settings_account() }] }),
});

/**
 * 账户分区：只有身份三行。刻意不放积分/额度/流水/上次活跃——额度只在生成白板图
 * 那一刻露面（WhiteboardQuotaHint），lastSeenAt 只入库不上屏。
 */
function AccountSettingsPage() {
  const { session, isGuest } = useEffectiveSession();
  const queryClient = useQueryClient();
  const user = session?.user;
  if (!user) return null;

  // charAt(0) 会把 emoji / 生僻字这类星平面字符切成半个代理对，渲染成 <?>。
  const initial = user.name ? [...user.name][0].toUpperCase() : "U";

  return (
    <SettingsSection title={m.settings_nav_account()} color="var(--sienna)">
      <SettingsRow
        leading={
          user.image ? (
            <img
              src={user.image}
              alt=""
              className="mt-0.5 h-8 w-8 flex-none rounded-full"
            />
          ) : (
            <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[var(--parchment-warm)] text-xs font-semibold text-[var(--ink-soft)]">
              {initial}
            </span>
          )
        }
        title={user.name || m.settings_account_profile()}
        meta={isGuest ? undefined : m.settings_account_signed_in_via()}
      />
      <SettingsRow title={m.settings_account_email()} meta={user.email} />
      {/* 审阅访客是 import.meta.env 派生的合成会话：signOut 对它是空操作，跳完首页
          它立刻又回来。跟 header-user 一样，这种会话只该看到「去登录」。 */}
      <li className="border-b border-[var(--line)]">
        <button
          type="button"
          onClick={() =>
            isGuest
              ? void startGitHubSignIn("/settings/account")
              : void signOutAndReset(queryClient)
          }
          className="flex w-full items-center justify-between py-3.5 text-left"
        >
          <RowTitle>
            {isGuest ? m.auth_sign_in_github() : m.auth_sign_out()}
          </RowTitle>
          <ChevronRight
            className="h-4 w-4 text-[var(--ink-soft)]"
            strokeWidth={1.25}
            aria-hidden
          />
        </button>
      </li>
    </SettingsSection>
  );
}
