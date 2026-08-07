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

  it("keeps immediately adjacent runs whose shared context is too short", () => {
    // �(�)：两个 run 的中间上下文只剩 "("，归一化后为空，双双安全放弃。
    const md = "the cost is reduced from �(�) to linear time overall.";
    const pdf = "the cost is reduced from 𝑂(𝑁) to linear time overall.";
    const result = repairFffd(md, pdf);
    expect(result.markdown).toBe(md);
    expect(result.total).toBe(2);
    expect(result.repaired).toBe(0);
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
    const md =
      "For query position � the model picks exactly top-� blocks; " +
      "the cost drops from �(�) to linear.";
    const pdf =
      "For query position 𝑖 the model picks exactly top-𝑘 blocks; " +
      "the cost drops from 𝑂(𝑁) to linear.";
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
});
