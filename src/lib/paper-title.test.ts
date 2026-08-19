import { describe, expect, it } from "vitest";
import {
  cleanExtractedTitle,
  isPlaceholderTitle,
  resolveFinalTitle,
} from "./paper-title";

// 下面的输入全部取自生产库里实际存下来的脏标题（2026-08 核查）
describe("cleanExtractedTitle", () => {
  it("剥掉 MinerU 把小型大写字母误判成下标而插入的标签", () => {
    expect(
      cleanExtractedTitle(
        "Th<sub>e</sub> P<sub>ersona</sub>li<sub>za</sub>ti<sub>on</sub> Mi<sub>rage:</sub> H<sub>ow</sub> LLM<sub>s</sub> F<sub>a</sub>b<sub>r</sub>i<sub>ca</sub>te",
      ),
    ).toBe("The Personalization Mirage: How LLMs Fabricate");
  });

  it("剥掉标点被包进下标的情况", () => {
    expect(
      cleanExtractedTitle(
        "Gaming Without an Attacker<sub>:</sub> Benchmark Fingerprinting in LLM<sub>-</sub>Driven Search",
      ),
    ).toBe(
      "Gaming Without an Attacker: Benchmark Fingerprinting in LLM-Driven Search",
    );
  });

  it("纯数字的上下标转成 Unicode，保住语义", () => {
    expect(
      cleanExtractedTitle("PR<sup>2</sup>: Predictive Routing Replay"),
    ).toBe("PR²: Predictive Routing Replay");
    expect(cleanExtractedTitle("H<sub>2</sub>O as Solvent")).toBe(
      "H₂O as Solvent",
    );
    expect(cleanExtractedTitle("Scaling to 10<sup>12</sup> Tokens")).toBe(
      "Scaling to 10¹² Tokens",
    );
  });

  it("去掉 LaTeX 转义反斜杠", () => {
    expect(
      cleanExtractedTitle(
        "StateM: Reaching 95.3% Raw Accuracy, or a \\$15 Frontier Run",
      ),
    ).toBe("StateM: Reaching 95.3% Raw Accuracy, or a $15 Frontier Run");
    expect(cleanExtractedTitle("Search \\& Rescue with 50\\% Budget")).toBe(
      "Search & Rescue with 50% Budget",
    );
    expect(cleanExtractedTitle("Fine\\_Tuning \\#1")).toBe("Fine_Tuning #1");
  });

  it("还原只包了一个符号的行内数学", () => {
    expect(
      cleanExtractedTitle(
        "FormaTheoria: Lean Theories $-$ Toward Formalization",
      ),
    ).toBe("FormaTheoria: Lean Theories - Toward Formalization");
  });

  it("还原 HTML 实体", () => {
    expect(
      cleanExtractedTitle("Retrieval &amp; Reasoning &lt;Survey&gt;"),
    ).toBe("Retrieval & Reasoning <Survey>");
  });

  it("折叠符号丢失后留下的连续空格", () => {
    expect(
      cleanExtractedTitle("AI for Auto-Research: Roadmap     User Guide"),
    ).toBe("AI for Auto-Research: Roadmap User Guide");
    expect(cleanExtractedTitle("  Leading\nand trailing\t ")).toBe(
      "Leading and trailing",
    );
  });

  it("不碰标题里合法的小于号和真 LaTeX 数学", () => {
    expect(
      cleanExtractedTitle("TurboVLA: Real-Time VLA at 32 Hz with <1 GB VRAM"),
    ).toBe("TurboVLA: Real-Time VLA at 32 Hz with <1 GB VRAM");
    expect(cleanExtractedTitle("DR$^{3}$-Eval: Deep Research Evaluation")).toBe(
      "DR$^{3}$-Eval: Deep Research Evaluation",
    );
  });

  it("对干净标题是恒等变换", () => {
    const clean =
      "MergeDNA: Context-aware Genome Modeling with Dynamic Tokenization";
    expect(cleanExtractedTitle(clean)).toBe(clean);
  });

  it("幂等", () => {
    const raw = "PR<sup>2</sup>: a \\$15 run &amp; more";
    expect(cleanExtractedTitle(cleanExtractedTitle(raw))).toBe(
      cleanExtractedTitle(raw),
    );
  });
});

describe("isPlaceholderTitle", () => {
  it("识别兜底形态", () => {
    expect(isPlaceholderTitle("")).toBe(true);
    expect(isPlaceholderTitle("   ")).toBe(true);
    expect(isPlaceholderTitle(null)).toBe(true);
    expect(isPlaceholderTitle("2410.01756")).toBe(true);
    expect(isPlaceholderTitle("arXiv:2511.14806")).toBe(true);
    expect(isPlaceholderTitle("2604.02029v2")).toBe(true);
    expect(isPlaceholderTitle("https://arxiv.org/abs/2608.04570")).toBe(true);
    expect(isPlaceholderTitle("Paper a1b2c3d4")).toBe(true);
    expect(isPlaceholderTitle("Microsoft Word - 101AlphasWeb.docx")).toBe(true);
    expect(isPlaceholderTitle("attention-is-all-you-need.pdf")).toBe(true);
  });

  it("不误判真标题", () => {
    expect(isPlaceholderTitle("101 Formulaic Alphas")).toBe(false);
    expect(isPlaceholderTitle("GPT-4 Technical Report")).toBe(false);
    // 版本号像 arXiv 编号但有后文
    expect(isPlaceholderTitle("2410.01756: ImageFolder")).toBe(false);
  });
});

describe("resolveFinalTitle", () => {
  it("arXiv 来源保留权威标题，忽略解析出的脏标题", () => {
    expect(
      resolveFinalTitle({
        sourceType: "arxiv",
        existingTitle:
          "The Personalization Mirage: How LLMs Fabricate User Profiles",
        extractedTitle:
          "Th<sub>e</sub> P<sub>ersona</sub>li<sub>za</sub>tion Mirage",
      }),
    ).toEqual({
      title: "The Personalization Mirage: How LLMs Fabricate User Profiles",
      source: "existing",
    });
  });

  it("arXiv 来源的标题是占位时，让位给解析标题并清洗", () => {
    expect(
      resolveFinalTitle({
        sourceType: "arxiv",
        existingTitle: "https://arxiv.org/abs/2608.02499",
        extractedTitle: "SWE-Touch<sub>:</sub> Benchmarking Coding Agents",
      }),
    ).toEqual({
      title: "SWE-Touch: Benchmarking Coding Agents",
      source: "extracted",
    });
  });

  it("上传来源仍以解析标题为准（文件名不是权威标题）", () => {
    expect(
      resolveFinalTitle({
        sourceType: "upload",
        existingTitle: "1755000000-my-paper.pdf",
        extractedTitle: "Attention Is All You Need",
      }),
    ).toEqual({ title: "Attention Is All You Need", source: "extracted" });
  });

  it("上传来源即使入库标题像真标题也让解析结果覆盖", () => {
    expect(
      resolveFinalTitle({
        sourceType: "upload",
        existingTitle: "Some Title Typed By User",
        extractedTitle: "Attention Is All You Need",
      }).source,
    ).toBe("extracted");
  });

  it("解析没给出标题时保留原值", () => {
    expect(
      resolveFinalTitle({
        sourceType: "upload",
        existingTitle: "my-paper.pdf",
        extractedTitle: null,
      }),
    ).toEqual({ title: "my-paper.pdf", source: "existing" });
  });

  it("两边都空时返回空串而不是抛错", () => {
    expect(
      resolveFinalTitle({
        sourceType: "arxiv",
        existingTitle: "",
        extractedTitle: "   ",
      }),
    ).toEqual({ title: "", source: "existing" });
  });
});
