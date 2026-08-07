import { describe, expect, it } from "vitest";
import { repairFffd } from "./mineru-fffd";

describe("repairFffd", () => {
  it("returns the same reference on the fast path (no U+FFFD)", () => {
    const md = "A clean markdown document with no damage at all.";
    const result = repairFffd(md, "irrelevant pdf text");
    expect(result.markdown).toBe(md);
    expect(result.total).toBe(0);
    expect(result.repaired).toBe(0);
  });

  it("repairs a typical lost astral char from the pdf text layer", () => {
    const md = "We analyze the Top-� subset selection strategy in detail.";
    const pdf = "We analyze the Top-𝑘 subset selection strategy in detail.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(
      "We analyze the Top-𝑘 subset selection strategy in detail.",
    );
    expect(result.total).toBe(1);
    expect(result.repaired).toBe(1);
  });

  it("repairs when the context matches multiple positions with the same gap", () => {
    const md = "Then we pick the top-� blocks for scoring.";
    const pdf =
      "First we pick the top-𝑘 blocks for scoring. " +
      "Later we pick the top-𝑘 blocks for scoring again.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe("Then we pick the top-𝑘 blocks for scoring.");
    expect(result.repaired).toBe(1);
  });

  it("keeps the run when matches are ambiguous (different gaps)", () => {
    const md = "Then we pick the top-� blocks for scoring.";
    const pdf =
      "First we pick the top-𝑘 blocks for scoring. " +
      "Later we pick the top-𝑚 blocks for scoring again.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(md);
    expect(result.total).toBe(1);
    expect(result.repaired).toBe(0);
  });

  it("rejects ASCII gaps (misalignment safety gate)", () => {
    const md = "We analyze the Top-� subset selection strategy in detail.";
    const pdf = "We analyze the Top-k subset selection strategy in detail.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(md);
    expect(result.repaired).toBe(0);
  });

  it("rejects gaps longer than 8 code points", () => {
    const md = "We analyze the Top-� subset selection strategy in detail.";
    const pdf =
      "We analyze the Top-𝑎𝑏𝑐𝑑𝑒𝑓𝑔𝑖𝑗 subset selection strategy in detail.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(md);
    expect(result.repaired).toBe(0);
  });

  it("never copies U+FFFD back from a damaged pdf text layer", () => {
    const md = "We analyze the Top-� subset selection strategy in detail.";
    const pdf = "We analyze the Top-� subset selection strategy in detail.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(md);
    expect(result.repaired).toBe(0);
  });

  it("repairs a run of multiple � as a single astral char", () => {
    // 𝑘 在 UTF-16 里是 2 个 unit，MinerU 可能吐 1–2 个 �。
    const md = "We analyze the Top-�� subset selection strategy in detail.";
    const pdf = "We analyze the Top-𝑘 subset selection strategy in detail.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(
      "We analyze the Top-𝑘 subset selection strategy in detail.",
    );
    expect(result.total).toBe(1);
    expect(result.repaired).toBe(1);
  });

  it("repairs immediately adjacent runs via the cluster path", () => {
    // �(�)：两个 run 的中间上下文只剩 "("，归一化后为空，单 run 路径无解；
    // 簇路径联合匹配（每个 gap 至少 1 个单元）唯一分割出 𝑂/𝑁。
    const md = "the cost is reduced from �(�) to linear time overall.";
    const pdf = "the cost is reduced from 𝑂(𝑁) to linear time overall.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(
      "the cost is reduced from 𝑂(𝑁) to linear time overall.",
    );
    expect(result.total).toBe(2);
    expect(result.repaired).toBe(2);
  });

  it("repairs two nearby runs when the shared context is long enough", () => {
    const md =
      "For query position � the model picks exactly top-� blocks in every layer.";
    const pdf =
      "For query position 𝑖 the model picks exactly top-𝑘 blocks in every layer.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(
      "For query position 𝑖 the model picks exactly top-𝑘 blocks in every layer.",
    );
    expect(result.total).toBe(2);
    expect(result.repaired).toBe(2);
  });

  it("matches through markdown emphasis and inline math syntax", () => {
    const md = "In practice we choose **Top-�** selection for all groups here.";
    const pdf = "In practice we choose Top-𝑘 selection for all groups here.";
    expect(repairFffd(md, pdf).markdown).toBe(
      "In practice we choose **Top-𝑘** selection for all groups here.",
    );

    const mdMath =
      "the scaling value $�$ controls sparsity of the attention map.";
    const pdfMath =
      "the scaling value 𝑘 controls sparsity of the attention map.";
    expect(repairFffd(mdMath, pdfMath).markdown).toBe(
      "the scaling value $𝑘$ controls sparsity of the attention map.",
    );
  });

  it("matches LaTeX commands in markdown against real glyphs in the pdf", () => {
    // markdown 写 \mathcal{H}_r，PDF 文本层是 ℋ𝑟：靠命令剥除 + 数学字母折叠对齐。
    const md =
      "Let $\\mathcal { H } _ { r }$ denote the � heads in every group r.";
    const pdf = "Let ℋ𝑟 denote the 𝐺 heads in every group r.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(
      "Let $\\mathcal { H } _ { r }$ denote the 𝐺 heads in every group r.",
    );
    expect(result.repaired).toBe(1);
  });

  it("repairs Greek math letters", () => {
    const md = "the learning rate � decays linearly over training epochs here.";
    const pdf =
      "the learning rate 𝛼 decays linearly over training epochs here.";
    expect(repairFffd(md, pdf).markdown).toBe(
      "the learning rate 𝛼 decays linearly over training epochs here.",
    );
  });

  it("repairs a multi code point gap, dropping pdf-side whitespace inside it", () => {
    // 一个 run 对应两个 astral 字符；PDF 文本层中间的空白按归一化语义丢弃。
    const md = "the parameter pair � controls the tradeoff between speed here.";
    const pdf =
      "the parameter pair 𝛼 𝛽 controls the tradeoff between speed here.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(
      "the parameter pair 𝛼𝛽 controls the tradeoff between speed here.",
    );
    expect(result.total).toBe(1);
    expect(result.repaired).toBe(1);
  });

  it("is idempotent on both repaired and unrepairable output", () => {
    // 后半段的 �(�) 簇在 PDF 里没有对应上下文（PDF 写的是 drops quickly），
    // 单 run 与簇路径都无解，保持不可修，验证幂等覆盖两种结果。
    const md =
      "For query position � the model picks exactly top-� blocks; " +
      "the cost drops from �(�) to linear.";
    const pdf =
      "For query position 𝑖 the model picks exactly top-𝑘 blocks; " +
      "the cost drops quickly in practice.";
    const first = repairFffd(md, pdf);
    expect(first.repaired).toBeGreaterThan(0);
    expect(first.repaired).toBeLessThan(first.total);
    const second = repairFffd(first.markdown, pdf);
    expect(second.markdown).toBe(first.markdown);
    expect(second.repaired).toBe(0);
  });

  it("keeps everything outside the runs byte-identical", () => {
    const md =
      "Header **bold** text.\n\nFor query position � the model picks " +
      "exactly top-� blocks; unmatched � stays.\n";
    // 第三个 run 的 suffix（"stays."）归一化后不足最小长度，安全放弃。
    const pdf =
      "For query position 𝑖 the model picks exactly top-𝑘 blocks; unmatched 𝑥 stays.";
    const result = repairFffd(md, pdf);
    expect(result.total).toBe(3);
    expect(result.repaired).toBe(2);
    // 除 � 片段外逐字节一致：把回补出的字符替换回 �，应还原输入。
    expect(result.markdown.replace(/𝑖|𝑘/gu, "�")).toBe(md);
    expect(result.markdown).toBe(
      "Header **bold** text.\n\nFor query position 𝑖 the model picks " +
        "exactly top-𝑘 blocks; unmatched � stays.\n",
    );
  });

  it("gives up near document boundaries where context is too short", () => {
    const md = "� subset selection is used";
    const pdf = "𝑘 subset selection is used";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(md);
    expect(result.repaired).toBe(0);
  });

  // ① 非 ASCII 标点/符号丢弃集扩展
  it("aligns through LaTeX \\times against a real multiplication sign", () => {
    // md 写 \times（命令被剥），PDF 文本层是真实 ×（U+00D7，Sm）：丢弃后两侧一致。
    const md =
      "the corpus grows from $2.58 \\times 10^{5}$ tokens to � items overall.";
    const pdf = "the corpus grows from 2.58×105 tokens to 𝑁 items overall.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(
      "the corpus grows from $2.58 \\times 10^{5}$ tokens to 𝑁 items overall.",
    );
    expect(result.repaired).toBe(1);
  });

  it("aligns through LaTeX \\prime against a real prime character", () => {
    // md 写 \prime，PDF 文本层是真实 ′（U+2032，标点）。
    const md =
      "the updated state $s^{\\prime}$ then feeds the � module directly.";
    const pdf = "the updated state s′ then feeds the 𝑄 module directly.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(
      "the updated state $s^{\\prime}$ then feeds the 𝑄 module directly.",
    );
    expect(result.repaired).toBe(1);
  });

  it("no longer restores a lost standalone symbol (dropped from comparison)", () => {
    // ① 的取舍：×/∈ 等非 ASCII 标点符号不在比较流里，作为丢失字符不可回补。
    const md =
      "the operation a � b denotes elementwise product in this section.";
    const pdf =
      "the operation a × b denotes elementwise product in this section.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(md);
    expect(result.repaired).toBe(0);
  });

  // ② <sub>/<sup> 标签剥除
  it("repairs a damaged char wrapped in sub tags", () => {
    const md =
      "the hidden state h<sub>�</sub> evolves smoothly over time steps.";
    const pdf = "the hidden state ℎ𝑡 evolves smoothly over time steps.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(
      "the hidden state h<sub>𝑡</sub> evolves smoothly over time steps.",
    );
    expect(result.repaired).toBe(1);
  });

  it("repairs a run whose suffix context is a legit sub tag with content", () => {
    const md = "the memory component �<sub>mem</sub> stores past activations.";
    const pdf = "the memory component 𝑀mem stores past activations.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(
      "the memory component 𝑀<sub>mem</sub> stores past activations.",
    );
    expect(result.repaired).toBe(1);
  });

  // ③ 相邻 run 链式联合匹配
  it("repairs a two-run chain joined by a short mid segment", () => {
    const md = "the two representations � and � (from different layers) align.";
    const pdf =
      "the two representations 𝑋 and 𝑌 (from different layers) align.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(
      "the two representations 𝑋 and 𝑌 (from different layers) align.",
    );
    expect(result.total).toBe(2);
    expect(result.repaired).toBe(2);
  });

  it("repairs a three-run chain and stays idempotent", () => {
    const md = "we set the scale � = 10, � = 1, � = 32 for all experiments.";
    const pdf = "we set the scale 𝛼 = 10, 𝛽 = 1, 𝛾 = 32 for all experiments.";
    const first = repairFffd(md, pdf);
    expect(first.markdown).toBe(
      "we set the scale 𝛼 = 10, 𝛽 = 1, 𝛾 = 32 for all experiments.",
    );
    expect(first.total).toBe(3);
    expect(first.repaired).toBe(3);
    const second = repairFffd(first.markdown, pdf);
    expect(second.markdown).toBe(first.markdown);
    expect(second.repaired).toBe(0);
  });

  it("abandons the whole cluster when one chained gap is ASCII", () => {
    // 簇内原子性：X 是 ASCII 不过闸，连同本可回补的 𝑌 一起放弃，零替换。
    const md = "the two representations � and � (from different layers) align.";
    const pdf =
      "the two representations X and 𝑌 (from different layers) align.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(md);
    expect(result.repaired).toBe(0);
  });

  it("abandons the whole cluster when the chain is ambiguous", () => {
    // 两处完整匹配给出不同 gap 元组（𝑋/𝑌 与 𝐴/𝐵），整簇放弃。
    const md = "the two representations � and � (from different layers) align.";
    const pdf =
      "the two representations 𝑋 and 𝑌 (from different layers) align. " +
      "the two representations 𝐴 and 𝐵 (from different layers) align.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(md);
    expect(result.repaired).toBe(0);
  });

  it("abandons clusters longer than the run cap", () => {
    // 7 个 run 连成一簇，超过 CLUSTER_MAX_RUNS=6，整簇放弃。
    const md = "we sweep the values �, �, �, �, �, �, � over the search grid.";
    const pdf = "we sweep the values 𝛼, 𝛽, 𝛾, 𝛿, 𝜖, 𝜁, 𝜂 over the search grid.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(md);
    expect(result.total).toBe(7);
    expect(result.repaired).toBe(0);
  });
});
