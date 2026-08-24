import { Sparkles } from "lucide-react";
import { Button } from "#/components/ui/button";
import { startGitHubSignIn } from "#/lib/auth-client";
import { m } from "#/paraglide/messages";

/**
 * /assistant 的匿名形态: 功能介绍 + 一组静态示例问答 + 登录入口。示例回答是
 * 写死的示意文案, 不调用模型 —— 这页的任务是让访客知道登录后能得到什么,
 * 不是免费提供助手。
 */
export function AssistantPreview() {
  return (
    <main className="page-wrap flex min-h-[70dvh] items-center justify-center py-8">
      <div className="rise-in max-w-xl text-center">
        <Sparkles
          className="mx-auto h-8 w-8 text-[var(--academic-brown)]"
          strokeWidth={1.25}
        />
        <h1 className="mt-4 font-serif text-2xl font-bold text-[var(--ink)]">
          {m.assistant_page_title()}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
          {m.assistant_preview_desc()}
        </p>

        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4 text-left">
          <p className="font-serif text-[13.5px] font-semibold text-[var(--ink)]">
            {m.home_assistant_sample()}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--ink-soft)]">
            {m.assistant_preview_answer()}
          </p>
        </div>

        <Button
          className="mt-6"
          onClick={() => void startGitHubSignIn("/assistant")}
        >
          {m.auth_sign_in_github()}
        </Button>
      </div>
    </main>
  );
}
