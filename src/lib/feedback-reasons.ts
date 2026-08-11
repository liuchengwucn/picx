// 踩票理由分类的唯一一份文案表。前台的 chip（feedback-buttons）与管理页的反馈流
// （components/admin/feedback-panel）都从这里取。存在的理由就两条：去重，以及保住
// 下面那个 Record<枚举键, …> 的穷尽性——各抄一遍的话，枚举加成员时只会有一处编译
// 报错，另一处静默显示原始枚举值。
//
// 单独成文件而不是塞进 #/lib/paper-feedback，是因为那个模块 import 了 #/db/schema
// （likeCountSql 需要表定义）。注意这并不意味着客户端包里没有 schema：
// feedback-buttons 仍从 paper-feedback 取 FEEDBACK_REASON_TEXT_MAX_LENGTH，schema
// 早就在包里了。这里只是不再新增一条 schema 引用边。
import type { inferRouterInputs } from "@trpc/server";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { m } from "#/paraglide/messages";

export type FeedbackReasonPreset = NonNullable<
  inferRouterInputs<TRPCRouter>["paper"]["setFeedback"]["reasonPreset"]
>;

/**
 * 有 chip 的理由。"other" 故意不在这里: 它和「只填了自由文本」表达的是同一件事
 * (理由在 reasonText 里), 多一个合成分类只会稀释口味统计, 所以自由文本不带 preset 提交。
 */
export type ChipReasonPreset = Exclude<FeedbackReasonPreset, "other">;

/** 键序即 chip 展示序。枚举加成员时这个 Record 会编译报错, 逼着这里同步。 */
export const REASON_CHIP_LABELS: Record<ChipReasonPreset, () => string> = {
  "off-topic": () => m.feedback_reason_off_topic(),
  incremental: () => m.feedback_reason_incremental(),
  hype: () => m.feedback_reason_hype(),
  seen: () => m.feedback_reason_seen(),
};

export const REASON_CHIPS = Object.keys(
  REASON_CHIP_LABELS,
) as ChipReasonPreset[];

/**
 * 读一条已落库的 reasonPreset 的展示文案。库里的值是 string（不是收窄过的枚举），
 * 认不出来就原样回显——编一句假的分类名只会污染口味统计的读法。
 */
export function feedbackReasonLabel(preset: string): string {
  return preset in REASON_CHIP_LABELS
    ? REASON_CHIP_LABELS[preset as ChipReasonPreset]()
    : preset;
}
