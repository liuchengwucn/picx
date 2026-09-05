// 采纳前校验的纯函数测试。第一组用的是 pretrain-data 第 2 期的真实原文/提案
// （docs/tmp/digest-audit/pretrain-data.md，gitignore，故内联）——正是它把「口味」
// 与「不在本方向范围内」两段整段丢掉，且提案比原文更长，所以只有段落判据能抓住。
import { describe, expect, it } from "vitest";
import {
  checkProposalCompleteness,
  MIN_PROPOSAL_LENGTH_RATIO,
} from "./focus-proposal";

const PRETRAIN_DATA_BRIEF =
  "当前关注：(1) 语料构建与配比（混合比例的拟合与 proxy→target 外推、去重与质量过滤、以及文档抽取质量本身作为一条数据质量轴——从 PDF、扫描件与富格式文档经 OCR 与版面解析得到的语料，正成为新增的边际 token 供给）；(2) 合成数据的收益边界（改写比例的甜点区与坍缩阈值、不同合成类型的过量阈值差异）；(3) 数据受限与重复利用（模型容量与重复轮数的权衡、正则化强度需随数据受限程度上调、按记忆化程度决定复用哪部分样本）；(4) mid-training / 继续预训练 / 退火阶段的数据选择——并注意评判标准正从 base loss 转向「后训练上限」（pass@k、RL 可训练性）。口味：偏好在真实规模（≥1B 参数）上给出证据、含消融与对照、公开数据配方或语料的工作，重视能改变别人配比决策的结论。对 100M 以下 toy 规模就外推大结论、无消融的 benchmark 刷分、把常规数据清洗流程包装成贡献的论文不感兴趣。不在本方向范围内（一律不选）：训练目标函数与优化器本身的设计、模型架构、完整模型技术报告——只收把语料或数据配比当作研究对象的工作。";

const PRETRAIN_DATA_PROPOSAL_ISSUE_2 =
  "当前关注：(1) 语料构建与配比（混合比例的拟合与 proxy→target 外推、去重与质量过滤、以及文档抽取质量本身作为一条数据质量轴——从 PDF、扫描件与富格式文档经 OCR 与版面解析得到的语料，正成为新增的边际 token 供给；并关注「notation/结构编码」——文档排布如何被写进语料——作为此前未测量的变量，以及结构线索（announcement）对长上下文训练的影响）；(2) 合成数据的收益边界（改写比例的甜点区与坍缩阈值、不同合成类型的过量阈值差异、以及合成内容的书级组织等结构维度）；(3) 数据受限与重复利用（模型容量与重复轮数的权衡、重复存在「反效果区间」而非单纯收益递减、重复率应作为混合优化的一等变量、正则化强度需随数据受限程度上调、按记忆化程度决定复用哪部分样本）；(4) mid-training / 继续预训练 / 退火阶段的数据选择——并注意评判标准正从 base loss 转向「后训练上限」（pass@k、RL 可训练性），数据选择信号也应随之从困惑度转向通过率/几何等后训练导向信号。";

describe("checkProposalCompleteness", () => {
  it("flags both guardrail sections dropped by the pretrain-data issue #2 proposal", () => {
    const result = checkProposalCompleteness(
      PRETRAIN_DATA_BRIEF,
      PRETRAIN_DATA_PROPOSAL_ISSUE_2,
    );
    expect(result.missingSections).toEqual(["口味", "不在本方向范围内"]);
    // 丢了两整句，长度却只掉到 94%（(1)-(4) 那段同时被写长了）：70% 的长度闸
    // 离这个真实事故差得很远，段落判据才是抓住它的那一条。
    expect(result.lengthRatio).toBeGreaterThan(0.9);
    expect(result.tooShort).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("accepts a proposal that rewrites the guarded sections instead of dropping them", () => {
    const rewritten =
      `${PRETRAIN_DATA_PROPOSAL_ISSUE_2}` +
      "口味：偏好在 ≥1B 规模上给出对照与消融的工作，且结论能改变配比决策。" +
      "不在本方向范围内（一律不选）：优化器设计、模型架构、完整技术报告。";
    const result = checkProposalCompleteness(PRETRAIN_DATA_BRIEF, rewritten);
    expect(result.missingSections).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("guards 硬标准 the same way", () => {
    const original = "当前关注：稀疏专家路由。硬标准：必须有 ≥7B 规模的实测。";
    expect(
      checkProposalCompleteness(
        original,
        "当前关注：稀疏专家路由与训练稳定性。",
      ).missingSections,
    ).toEqual(["硬标准"]);
    expect(
      checkProposalCompleteness(
        original,
        "当前关注：稀疏专家路由与训练稳定性。硬标准：需要 ≥7B 规模实测与对照。",
      ).missingSections,
    ).toEqual([]);
  });

  it("does not count a keyword mentioned mid-sentence as the section surviving", () => {
    const result = checkProposalCompleteness(
      PRETRAIN_DATA_BRIEF,
      "当前关注：数据配比。我们沿用了上一版的口味与范围约定，不再重复列出。",
    );
    expect(result.missingSections).toEqual(["口味", "不在本方向范围内"]);
  });

  it("recognizes ASCII colons and list-marker prefixes", () => {
    const original = "当前关注：数据配比。口味: 偏好大规模实证。";
    const proposal =
      "当前关注：数据配比与合成数据。\n- **口味**: 偏好大规模实证与消融。";
    expect(
      checkProposalCompleteness(original, proposal).missingSections,
    ).toEqual([]);
  });

  it("flags a proposal that lost most of its length", () => {
    const original = `当前关注：${"数据配比与语料质量。".repeat(20)}`;
    const result = checkProposalCompleteness(original, "当前关注：数据配比。");
    expect(result.tooShort).toBe(true);
    expect(result.lengthRatio).toBeLessThan(MIN_PROPOSAL_LENGTH_RATIO);
    expect(result.ok).toBe(false);
  });

  it("passes a proposal that only trims slightly", () => {
    const original = `当前关注：${"数据配比与语料质量。".repeat(20)}`;
    const proposal = `当前关注：${"数据配比与语料质量。".repeat(16)}`;
    const result = checkProposalCompleteness(original, proposal);
    expect(result.tooShort).toBe(false);
    expect(result.ok).toBe(true);
  });

  it("treats an empty current brief as nothing to protect", () => {
    const result = checkProposalCompleteness("", "当前关注：数据配比。");
    expect(result.ok).toBe(true);
    expect(result.lengthRatio).toBe(1);
  });
});
