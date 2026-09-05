/**
 * synthesize 出口校验。用例形状一律取自线上前三期简报的真实缺陷，
 * 不用臆造的最小样例——这些检查的价值全在「能不能抓住实际发生过的那一种写法」。
 */
import { describe, expect, it } from "vitest";
import {
  buildAllowedArxivIds,
  buildRetryInstruction,
  collectLinkViolations,
  collectSynthesisIssues,
  demoteMarkdownLinks,
  extractUrls,
  findInternalWording,
  findMissingSections,
  isArxivUrl,
  isExaUrl,
  replaceWeeklyWording,
  type SynthesisIssue,
  stripIssuePrefix,
} from "./synthesis-guards";

describe("buildAllowedArxivIds", () => {
  it("normalizes abs/pdf/version forms to the same id", () => {
    const ids = buildAllowedArxivIds([
      "https://arxiv.org/abs/2608.13057",
      "https://arxiv.org/pdf/2605.08639v3",
      "http://www.arxiv.org/abs/2601.00001.pdf",
    ]);
    expect([...ids].sort()).toEqual(["2601.00001", "2605.08639", "2608.13057"]);
  });

  it("ignores null/undefined (papers.source_url is nullable) and non-arXiv hosts", () => {
    // 关键：非 arxiv host 里撞上 id 形状的数字不得撑松白名单
    const ids = buildAllowedArxivIds([
      null,
      undefined,
      "",
      "https://exa.ai/library/2608.13057",
      "https://openreview.net/forum?id=2605.08639",
    ]);
    expect(ids.size).toBe(0);
  });
});

describe("host predicates", () => {
  it("matches arxiv.org and its subdomains only", () => {
    expect(isArxivUrl("https://arxiv.org/abs/2608.1")).toBe(true);
    expect(isArxivUrl("https://www.arxiv.org/abs/2608.1")).toBe(true);
    expect(isArxivUrl("https://notarxiv.org/abs/2608.1")).toBe(false);
    expect(isArxivUrl("not a url")).toBe(false);
  });

  it("matches exa.ai library pages", () => {
    expect(isExaUrl("https://exa.ai/library/abc-def")).toBe(true);
    expect(isExaUrl("https://www.exa.ai/library/abc")).toBe(true);
    expect(isExaUrl("https://exa.example.com/x")).toBe(false);
  });
});

describe("extractUrls", () => {
  it("finds markdown link targets and bare urls, trimming trailing punctuation", () => {
    const md =
      "见 [PR²](https://arxiv.org/abs/2608.13057) 与 https://example.com/post。另见 (https://arxiv.org/abs/2605.08639)，完。";
    expect(extractUrls(md)).toEqual([
      "https://arxiv.org/abs/2608.13057",
      "https://example.com/post",
      "https://arxiv.org/abs/2605.08639",
    ]);
  });

  it("dedupes repeated urls", () => {
    const md = "[a](https://x.dev/p) 又见 [b](https://x.dev/p)";
    expect(extractUrls(md)).toEqual(["https://x.dev/p"]);
  });
});

describe("collectLinkViolations", () => {
  const allowed = buildAllowedArxivIds([
    "https://arxiv.org/abs/2607.00001", // 本期 paper 候选
    "https://arxiv.org/abs/2606.00002", // 往期 pick
  ]);

  it("flags an invented arXiv link for a past pick (moe #2/#3 事故形状)", () => {
    const content =
      "上期提到的 [PR²](https://arxiv.org/abs/2608.13057) 与 [Kimi K3](https://arxiv.org/abs/2605.08639) 都在这条线上。";
    expect(collectLinkViolations([content], allowed).fabricatedArxiv).toEqual([
      "https://arxiv.org/abs/2608.13057",
      "https://arxiv.org/abs/2605.08639",
    ]);
  });

  it("accepts supplied arXiv links regardless of abs/pdf/version form", () => {
    const content =
      "[A](https://arxiv.org/pdf/2607.00001v2) 与 [B](https://arxiv.org/abs/2606.00002)";
    expect(collectLinkViolations([content], allowed).fabricatedArxiv).toEqual(
      [],
    );
  });

  it("leaves third-party links alone (web_search 引用是 prompt 明确要求的)", () => {
    const content =
      "[官方博客](https://openai.com/index/x) [repo](https://github.com/a/b)";
    const v = collectLinkViolations([content], allowed);
    expect(v.fabricatedArxiv).toEqual([]);
    expect(v.exa).toEqual([]);
  });

  it("flags exa.ai links even though they can be real intel candidates", () => {
    const content = "[某综述](https://exa.ai/library/foo-bar)";
    expect(collectLinkViolations([content], allowed).exa).toEqual([
      "https://exa.ai/library/foo-bar",
    ]);
  });

  it("flags arxiv.org links whose id cannot be parsed (list/search pages)", () => {
    const content = "[最新](https://arxiv.org/list/cs.CL/recent)";
    expect(collectLinkViolations([content], allowed).fabricatedArxiv).toEqual([
      "https://arxiv.org/list/cs.CL/recent",
    ]);
  });

  it("scans recommendationNotes too, deduping across texts", () => {
    const v = collectLinkViolations(
      [
        "正文 [X](https://arxiv.org/abs/2699.99999)",
        "推荐语 [X](https://arxiv.org/abs/2699.99999)",
      ],
      allowed,
    );
    expect(v.fabricatedArxiv).toEqual(["https://arxiv.org/abs/2699.99999"]);
  });
});

describe("demoteMarkdownLinks", () => {
  it("turns a bad link into plain text, keeping good ones", () => {
    const md =
      "[PR²](https://arxiv.org/abs/2608.13057) 与 [TEMPO](https://arxiv.org/abs/2607.00001) 对比。";
    const out = demoteMarkdownLinks(
      md,
      (u) => u === "https://arxiv.org/abs/2608.13057",
    );
    expect(out).toBe("PR² 与 [TEMPO](https://arxiv.org/abs/2607.00001) 对比。");
  });

  it("handles a link with a title segment", () => {
    const md = '[X](https://exa.ai/library/a "内部页")';
    expect(demoteMarkdownLinks(md, () => true)).toBe("X");
  });

  it("leaves bare urls untouched (只留痕不改写)", () => {
    const md = "见 https://exa.ai/library/a";
    expect(demoteMarkdownLinks(md, () => true)).toBe(md);
  });
});

describe("findMissingSections", () => {
  it("passes a well-formed body", () => {
    const body =
      "## 本期看点\n正文\n\n## 社区与动态\nx\n\n## 未解之问\n1. a\n2. b";
    expect(findMissingSections(body)).toEqual([]);
  });

  it("tolerates leading blank lines before 本期看点", () => {
    expect(
      findMissingSections("\n\n## 本期看点\nx\n## 未解之问\n1. a"),
    ).toEqual([]);
  });

  it("flags a missing lead section (self-improvement 第 1 期形状)", () => {
    const body = "本期我们关注三件事。\n\n## 未解之问\n1. a";
    expect(findMissingSections(body)).toEqual(["## 本期看点"]);
  });

  it("flags a renamed lead heading and a missing open-questions section", () => {
    const body = "## 本期要点\nx";
    expect(findMissingSections(body)).toEqual(["## 本期看点", "## 未解之问"]);
  });

  it("does not accept 未解之问 as a run-on line", () => {
    expect(
      findMissingSections("## 本期看点\nx\n## 未解之问与展望\n1. a"),
    ).toEqual(["## 未解之问"]);
  });
});

describe("findInternalWording", () => {
  it("catches the self-improvement #3 recommendationNote", () => {
    const note =
      "全文不可得、作者信号弱，方法学严谨性无法完全评估，但结论方向值得留意。";
    expect(findInternalWording([note])).toEqual(["作者信号", "全文不可得"]);
  });

  it("catches pretrain-data #2 「摘要较薄」 and english field names case-insensitively", () => {
    expect(findInternalWording(["摘要较薄，暂难判断"])).toEqual(["摘要较薄"]);
    expect(findInternalWording(["per the draft NOTE and risk FLAGS"])).toEqual([
      "Draft note",
      "Risk flags",
    ]);
  });

  it("returns nothing for clean reader-facing text", () => {
    expect(findInternalWording(["这篇给出了可复现的消融实验。"])).toEqual([]);
  });
});

describe("stripIssuePrefix", () => {
  it("strips the four-language issue prefixes", () => {
    expect(stripIssuePrefix("第3期：稀疏注意力的拐点")).toBe(
      "稀疏注意力的拐点",
    );
    expect(stripIssuePrefix("第 12 期 — 数据配比之争")).toBe("数据配比之争");
    expect(stripIssuePrefix("Issue 3: The Sparse Attention Turn")).toBe(
      "The Sparse Attention Turn",
    );
    expect(stripIssuePrefix("第3号：スパース注意の転換点")).toBe(
      "スパース注意の転換点",
    );
  });

  it("leaves a clean title alone and never eats content", () => {
    expect(stripIssuePrefix("  稀疏注意力的拐点  ")).toBe("稀疏注意力的拐点");
    // 无分隔符不算前缀，否则会吃掉正经标题
    expect(stripIssuePrefix("第3期回顾与展望")).toBe("第3期回顾与展望");
    expect(stripIssuePrefix("MoE：一次路由的胜利")).toBe("MoE：一次路由的胜利");
  });
});

describe("replaceWeeklyWording", () => {
  it("rewrites every occurrence of 本周/这周 (pretrain-data #3 形状)", () => {
    expect(
      replaceWeeklyWording(
        "本周出现一个可能改写配比决策的核心结论，这周尤为明显。",
      ),
    ).toBe("本期出现一个可能改写配比决策的核心结论，本期尤为明显。");
  });

  it("leaves 本期 alone", () => {
    expect(replaceWeeklyWording("本期共选 5 篇")).toBe("本期共选 5 篇");
  });
});

describe("collectSynthesisIssues", () => {
  const allowed = buildAllowedArxivIds(["https://arxiv.org/abs/2607.00001"]);
  const cleanBody = [
    "## 本期看点",
    "[A](https://arxiv.org/abs/2607.00001) 给出了新的路由稳定性结论。",
    "",
    "## 未解之问",
    "1. 该结论能否外推到更大规模？",
  ].join("\n");

  it("returns no issues for a clean draft", () => {
    expect(
      collectSynthesisIssues({
        content: cleanBody,
        notes: ["方法直接、消融充分，值得一读。"],
        allowedArxivIds: allowed,
      }),
    ).toEqual([]);
  });

  it("catches all four defect classes at once", () => {
    const content = [
      "## 本期要点",
      "本周 [#1] MiniMax 与 P2 的对比见 [PR²](https://arxiv.org/abs/2608.13057)，另见 [综述](https://exa.ai/library/x)。",
    ].join("\n");
    const issues = collectSynthesisIssues({
      content,
      notes: ["全文不可得，作者信号弱。"],
      allowedArxivIds: allowed,
    });
    expect(issues.map((i) => i.type).sort()).toEqual([
      "exa_link",
      "fabricated_arxiv",
      "internal_ref",
      "internal_wording",
      "missing_sections",
      "weekly_wording",
    ]);
  });

  it.each([
    ["[#1] MiniMax 提出", "[#1]"],
    ["上期 #1 的结论", "上期 #1"],
    ["#1 期提到过", "#1 期"],
    ["P1 与 I3 的差别", "P1"],
  ])("flags internal marker %s", (fragment, expected) => {
    const issues = collectSynthesisIssues({
      content: `## 本期看点\n${fragment}\n## 未解之问\n1. a`,
      notes: [],
      allowedArxivIds: allowed,
    });
    const ref = issues.find((i) => i.type === "internal_ref");
    expect(ref).toEqual({ type: "internal_ref", sample: expected });
  });

  it("accepts the sanctioned 「第 N 期的 X」 form", () => {
    const issues = collectSynthesisIssues({
      content: "## 本期看点\n第 1 期的 MiniMax 已给出对照。\n## 未解之问\n1. a",
      notes: [],
      allowedArxivIds: allowed,
    });
    expect(issues).toEqual([]);
  });

  it("detects 本周 inside a recommendationNote, not only in content", () => {
    const issues = collectSynthesisIssues({
      content: cleanBody,
      notes: ["本周最值得读的一篇。"],
      allowedArxivIds: allowed,
    });
    expect(issues).toEqual([{ type: "weekly_wording" }]);
  });
});

describe("buildRetryInstruction", () => {
  it("names the offending urls and markers so the retry has something concrete", () => {
    const issues: SynthesisIssue[] = [
      { type: "internal_ref", sample: "[#1]" },
      { type: "fabricated_arxiv", urls: ["https://arxiv.org/abs/2608.13057"] },
      { type: "exa_link", urls: ["https://exa.ai/library/x"] },
      { type: "missing_sections", missing: ["## 本期看点"] },
      { type: "internal_wording", terms: ["作者信号"] },
      { type: "weekly_wording" },
    ];
    const out = buildRetryInstruction(issues);
    expect(out).toContain("[#1]");
    expect(out).toContain("https://arxiv.org/abs/2608.13057");
    expect(out).toContain("https://exa.ai/library/x");
    expect(out).toContain("## 本期看点");
    expect(out).toContain("作者信号");
    expect(out).toContain("本周");
    // 每类违规恰好一行，外加一行开场白
    expect(out.split("\n")).toHaveLength(issues.length + 1);
  });
});
