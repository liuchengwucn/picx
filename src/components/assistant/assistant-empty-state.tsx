import type { SlashCommandItem } from "#/components/chat/chat-input";
import { m } from "#/paraglide/messages";

/** 芯片行最多放这么多技能：再多就从「入口」变成「又一个列表」 */
const MAX_SKILL_CHIPS = 6;

interface AssistantEmptyStateProps {
  /** 已启用的技能，调用方保证只传启用的 */
  skills: SlashCommandItem[];
  onPickSkill: (item: SlashCommandItem) => void;
  onPickSample: (text: string) => void;
}

const CHIP_CLASS =
  "rounded-full border border-[var(--line)] bg-[var(--parchment)] px-3 py-1.5 text-xs text-[var(--ink)] transition-colors hover:border-[var(--academic-brown)]/60 hover:bg-[var(--parchment-warm)] focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:outline-none";

/**
 * 技能名只受 skillNameSchema 约束（`^[a-z0-9]+(?:-[a-z0-9]+)*$`，最长 64 字符），
 * 不含连字符时没有任何断行机会——flex-wrap 只能在芯片之间换行，芯片内部的文本
 * 撑多宽就是多宽。所以这里必须显式限宽 + 截断，而不是指望自动换行兜底。
 * min-w-0 是必需的：这个 button 是 flex 子项，其默认 min-width:auto 会按内容的
 * min-content 宽度撑开（nowrap 文本的 min-content 就是整行宽度），一旦这个自动最小
 * 宽度超过 max-w，就会赢过 max-w 把盒子撑爆——truncate 也就等于没生效。
 */
const SKILL_CHIP_CLASS = `${CHIP_CLASS} min-w-0 max-w-[16rem] truncate font-mono text-[var(--academic-brown)]`;

const LABEL_CLASS =
  "mt-6 text-[10px] tracking-[0.16em] text-[var(--ink-soft)] uppercase";

/**
 * 空会话的封面。标题用衬线体，下面把「这个助手现在能替你做什么」摆成可点的东西——
 * 光写一句提示等于让用户对着白纸自己想。
 */
export function AssistantEmptyState({
  skills,
  onPickSkill,
  onPickSample,
}: AssistantEmptyStateProps) {
  const samples = [m.assistant_empty_sample_1(), m.assistant_empty_sample_2()];
  const visibleSkills = skills.slice(0, MAX_SKILL_CHIPS);

  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="min-w-0 max-w-[52ch] text-center">
        <span
          aria-hidden="true"
          className="mx-auto block h-px w-10 bg-[var(--academic-brown)]/45"
        />
        <h2 className="mt-5 font-serif text-2xl font-semibold text-balance text-[var(--ink)] sm:text-[1.75rem]">
          {m.assistant_empty_title()}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
          {m.assistant_empty_hint()}
        </p>

        {/* 一条技能都没有时整块不渲染：空标题下面挂个空行比没有更糟 */}
        {visibleSkills.length > 0 && (
          <>
            <p className={LABEL_CLASS}>{m.assistant_empty_skills_label()}</p>
            <div className="mt-2 flex min-w-0 flex-wrap justify-center gap-1.5">
              {visibleSkills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => onPickSkill(skill)}
                  title={`/${skill.name} — ${skill.description}`}
                  className={SKILL_CHIP_CLASS}
                >
                  /{skill.name}
                </button>
              ))}
            </div>
          </>
        )}

        <p className={LABEL_CLASS}>{m.assistant_empty_try_label()}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {samples.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => onPickSample(text)}
              className={CHIP_CLASS}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
