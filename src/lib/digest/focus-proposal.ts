// src/lib/digest/focus-proposal.ts
//
// focusBrief 更新提案的采纳前校验。**纯函数，无 db 依赖**——管理页组件直接 import
// （admin-store.ts 带 schema/db 依赖，不能进客户端包）。
//
// 起因：synthesize 的提案是「全量重写」而非增量补丁，实测 pretrain-data 第 2 期
// 的提案把原 brief 结尾的「口味：…」与「不在本方向范围内（一律不选）：…」两句
// 整段丢掉，只保留了 (1)-(4) 的关注点清单。管理页一键采纳会整段覆盖
// directions.focusBrief，于是排除规则被静默删除，下一期选材再没有护栏。
// 这里不阻止采纳（提案的判断有时确实该赢），只把「会丢什么」摆到按钮前面。

/**
 * 必须被提案继承的段落标记。判据是「原文里以它开头的段/句，提案里也得有一段以
 * 它开头」——不逐字比对：提案改写这些段落的内容是正当的，整段消失才是事故。
 * 「硬标准」是 focusBrief 里的选材硬闸段落标记，一并纳入护栏。
 */
export const GUARDED_SECTIONS = ["口味", "不在本方向范围内", "硬标准"] as const;
export type GuardedSection = (typeof GUARDED_SECTIONS)[number];

/** 提案短于原文这个比例即告警：全量重写的正常波动远小于此，掉这么多基本是漏写 */
export const MIN_PROPOSAL_LENGTH_RATIO = 0.7;

export interface ProposalCompleteness {
  /** 原文里有、提案里整段消失的标记（按 GUARDED_SECTIONS 原序） */
  missingSections: GuardedSection[];
  /** 提案长度 / 原文长度；原文为空时记 1 */
  lengthRatio: number;
  tooShort: boolean;
  /** 无任何缺失项 = 可以直接采纳，不必二次确认 */
  ok: boolean;
}

// 段落切分：换行，以及中英文句末标点。brief 实际是一整段长文，「口味：」这类
// 标记跟在上一句的句号后面，不切句就只能退化成「全文 includes」，那样提案里
// 任何位置偶然提到「口味」都会被算作没丢。
const SEGMENT_SPLIT = /[。！？；.!?;]|\n+/;
// 段首的装饰性前缀（列表符号、markdown 强调、各种引号括号）不参与起始词判断
const LEADING_DECOR = /^[\s\-*#>·—…()（）【】「」『』"'"'：:]+/;

function segmentStarts(text: string): string[] {
  return text
    .split(SEGMENT_SPLIT)
    .map((s) => s.replace(LEADING_DECOR, "").trim())
    .filter(Boolean);
}

function hasSection(text: string, keyword: string): boolean {
  return segmentStarts(text).some((s) => s.startsWith(keyword));
}

/**
 * 采纳前校验：原 brief 的护栏段落是否还在提案里 + 提案是否异常变短。
 * 只描述差异，不做裁决——调用方决定是警告还是拦截。
 */
export function checkProposalCompleteness(
  original: string,
  proposal: string,
): ProposalCompleteness {
  const originalText = original.trim();
  const proposalText = proposal.trim();
  const missingSections = GUARDED_SECTIONS.filter(
    (keyword) =>
      hasSection(originalText, keyword) && !hasSection(proposalText, keyword),
  );
  const lengthRatio =
    originalText.length === 0 ? 1 : proposalText.length / originalText.length;
  const tooShort = lengthRatio < MIN_PROPOSAL_LENGTH_RATIO;
  return {
    missingSections: [...missingSections],
    lengthRatio,
    tooShort,
    ok: missingSections.length === 0 && !tooShort,
  };
}
